/**
 * 討論を「1ステップ＝1 Cloud Task」のチェーンとして駆動するオーケストレータ。
 *
 * 各章は open → turn(複数) → summary/closing → comments という step の連鎖で進む。
 * 1ステップ処理するたびに次のステップを enqueue し、そのタスクが起動して advanceDebate を呼ぶ…という
 * 自己継続ループになっている。状態は毎回 Firestore（永続データ）から再構築するため、各ステップは
 * メモリ上の状態を引き継がず、いつ・何回起動されても同じ結果になる（冪等・再入可能）。
 *
 * 並走対策として「frontier（章ローカルのターン数 expectedTurnIndex）」を使う。複数タスクが同じ
 * frontier を狙っても、追記トランザクションで勝てるのは1つだけ。敗者・リトライは resume で
 * 最新状態から次ステップを再投入し、チェーンが途切れないようにする（liveness 保証）。
 */
import { getTopicById } from '../topics/topics.js';
import { getPersonasByTopicId } from '../personas/personas.js';
import { getChaptersByTopicId } from './debate-lifecycle.js';
import type { ChapterEntry } from './debate-lifecycle.js';
import {
	generateOpening,
	generateChapterIntroduction,
	evaluateDiscussionPointCoverage
} from '../../agents/facilitator-agent.js';
import { selectSpeaker } from './speaker-selection.js';
import { getDebateState, loadChapterProgress } from './debate-state.js';
import { enqueueTurnStep, taskKey } from './turn-step-task.js';
import {
	QUIET_STREAK_LIMIT,
	EARLY_END_PROGRESS_RATIO,
	TURN_CAP_RATIO,
	AGENDA_TURN_CAP_RATIO,
	CONTINUE_CHAPTER_THRESHOLD,
	TURNS_PER_CHAPTER,
	MAX_TURNS,
	DEFAULT_INTERVENTION_COOLDOWN
} from '../../constants/debate.constants.js';
import { evaluateEngagements, evaluateEngagementWithFallback } from './engagement.js';
import {
	expireQueuedIntents,
	addQueuedIntents,
	consumeQueuedIntent,
	loadQueuedIntents
} from './queued-intents.js';
import { tryIntervention } from './intervention.js';
import {
	isDebateActive,
	generateFacilitatorTurn,
	generatePersonaTurn,
	generateChapterTransition,
	appendClosingTurn,
	persistPostDebateComments,
	updateSpeakerStats,
	applyBeliefChange,
	getDebateTurnsByTopicId
} from './turn.js';
import { pipelineErrorMessage, validPersonaId } from './utils.js';
import type {
	SpeakerSelection,
	DebateState,
	DebateTurn,
	DebateOptions,
	DiscussionPointState,
	NextStep,
	TurnStepPayload
} from '../../types/debate.types.js';
import type { Chapter } from '../../types/chapter.types.js';
import type { Persona } from '../../types/persona.types.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const db = () => getFirestore();

export const DEFAULT_OPTIONS: DebateOptions = {
	turnsPerChapter: TURNS_PER_CHAPTER,
	maxTurns: MAX_TURNS,
	interventionCooldown: DEFAULT_INTERVENTION_COOLDOWN
};

/** 1ステップ処理に必要な、永続データから再構築した一式のコンテキスト */
type StepContext = {
	chapters: ChapterEntry[]; // トピックの全章
	chapterDoc: ChapterEntry; // 処理対象の章
	chapter: Chapter; // chapterDoc と同一（型を Chapter として扱う用）
	personas: Persona[]; // 承認済み参加ペルソナ
	topicTitle: string; // トピック名（プロンプト用）
	state: DebateState; // 全ターンから導出した討論状態（発言数・沈黙・キュー等）
	chapterTurnStartInState: number; // state.turns 内でこの章のターンが始まるオフセット
	quietStreak: number; // 盛り上がりが低いターンの連続数（早期終了判定用）
	isLastChapter: boolean; // この章が最終章か（true なら summary でなく closing へ）
};

/** 章ローカルの永続ターン末尾に未応答の指名（直接質問）が残っているか判定する */
const hasUnansweredTargetAtEnd = (chapterTurns: DebateTurn[]): boolean => {
	const last = chapterTurns[chapterTurns.length - 1];
	return !!(last?.targetPersonaId && last.targetedBy);
};

/**
 * 追記成功後、永続状態のみから次ステップ種別と期待位置を決める純関数。
 * while ループ版と等価な規則（cap・早期終了・最終応答 +1）で判定する。
 * 乱数・時刻・外部 I/O に依存しないため、同じ frontier を観測した複数の enqueuer が同一結果を計算する。
 */
export const decideNextStep = ({
	chapterTurns,
	globalTurnCount,
	quietStreak,
	discussionPoints,
	options,
	isLastChapter
}: {
	chapterTurns: DebateTurn[];
	globalTurnCount: number;
	quietStreak: number;
	discussionPoints: DiscussionPointState[];
	chapterIndex: number;
	options: DebateOptions;
	isLastChapter: boolean;
}): NextStep => {
	// 論点リストを持つ章は消化のため上限を高めに取る（AGENDA_TURN_CAP_RATIO > TURN_CAP_RATIO）
	const hasPoints = discussionPoints.length > 0;
	// この章の強制終了ターン数。目標ターン数 × 比率で算出する
	const cap = Math.ceil(
		options.turnsPerChapter * (hasPoints ? AGENDA_TURN_CAP_RATIO : TURN_CAP_RATIO)
	);
	const chapterTurnCount = chapterTurns.length;
	// 次に追記すべき章ローカル位置（= 現在のターン数）。frontier 照合に使う
	const expectedTurnIndex = chapterTurnCount;

	// 章上限に到達、または討論全体の上限に到達したか
	const hitCap = chapterTurnCount >= cap || globalTurnCount >= options.maxTurns;
	// 一定割合まで進み、かつ盛り上がりが連続して低い（quietStreak が上限超え）なら早期終了
	const earlyEnd =
		chapterTurnCount >= Math.ceil(options.turnsPerChapter * EARLY_END_PROGRESS_RATIO) &&
		quietStreak >= QUIET_STREAK_LIMIT;

	// まだ終了条件に達していなければ、通常のターンを続ける
	if (!hitCap && !earlyEnd) {
		return { kind: 'turn', expectedTurnIndex };
	}

	// 章終了と判定。末尾に未応答の指名が残れば最終応答ターン（+1）を1回挟む。
	// finalResponse フラグで標識し、当該ターン後は decideNextStep を再評価せず summary/closing へ直行する
	if (hasUnansweredTargetAtEnd(chapterTurns)) {
		return { kind: 'turn', expectedTurnIndex, finalResponse: true };
	}

	return isLastChapter
		? { kind: 'closing', expectedTurnIndex }
		: { kind: 'summary', expectedTurnIndex };
};

/** トピックと承認済みペルソナを取得する。討論に参加するのは approved なペルソナのみ */
const getTopicContext = async (topicId: string) => {
	const [topic, allPersonas] = await Promise.all([
		getTopicById(topicId),
		getPersonasByTopicId(topicId)
	]);
	if (!topic) throw new Error(`Topic not found: ${topicId}`);
	return { topicTitle: topic.title, personas: allPersonas.filter((p) => p.approved) };
};

/** 章ドキュメントに論点ステータス（point/status）を書き込む。論点を持たない章では何もしない */
const saveDiscussionPointStatuses = async (
	topicId: string,
	chapterId: string,
	state: DebateState
): Promise<void> => {
	if (state.discussionPoints.length === 0) return;
	await db()
		.doc(`topics/${topicId}/chapters/${chapterId}`)
		.update({
			discussionPointStatuses: state.discussionPoints.map((p) => ({
				point: p.point,
				status: p.status
			}))
		});
};

/** 章完了時に論点ステータスのフィールドごと削除する（クリーンアップ） */
const deleteDiscussionPointStatuses = async (topicId: string, chapterId: string): Promise<void> => {
	await db().doc(`topics/${topicId}/chapters/${chapterId}`).update({
		discussionPointStatuses: FieldValue.delete()
	});
};

/**
 * オープニング/導入で提示した論点を introduced に更新する。
 * index は「未消化(addressed でない)論点リスト」上の位置なので、そこから実体を引いて状態を変える。
 */
const markIntroduced = (state: DebateState, index: number | undefined): void => {
	if (index === undefined) return;
	const untouched = state.discussionPoints.filter((p) => p.status !== 'addressed');
	const target =
		untouched[index] !== undefined
			? state.discussionPoints.find((p) => p.point === untouched[index].point)
			: undefined;
	if (target) target.status = 'introduced';
};

/** 末尾ターンが誰かを指名（直接質問）していれば、その指名先と指名元を返す。なければ undefined */
const getLastTargetPersona = (
	turns: DebateTurn[]
): { personaId: string; targetedBy: 'facilitator' | 'persona' } | undefined => {
	const last = turns[turns.length - 1];
	if (!last?.targetPersonaId || !last.targetedBy) return undefined;
	return { personaId: last.targetPersonaId, targetedBy: last.targetedBy };
};

/** 章のステータス（running / completed など）を更新する */
const updateChapterStatus = async (
	topicId: string,
	chapterId: string,
	status: ChapterEntry['status']
): Promise<void> => {
	await db().doc(`topics/${topicId}/chapters/${chapterId}`).update({ status });
};

// ===================================================================
// 新経路: per-turn ステップチェーン（advanceDebate / runTurnStep の本体）
// ===================================================================

/** 既定オプションにペイロード由来の単章モードを重ねた実行オプションを作る */
const buildStepOptions = (payload: TurnStepPayload): DebateOptions => ({
	...DEFAULT_OPTIONS,
	singleChapterMode: payload.singleChapterMode
});

/** ステップ起動時に永続データのみから状態と章進捗を再構築する */
const loadStepContext = async (payload: TurnStepPayload): Promise<StepContext> => {
	const { topicId, chapterIndex, runId, singleChapterMode } = payload;
	const chapters = await getChaptersByTopicId(topicId);
	if (!chapters.length) throw new Error('Chapters not found');
	const chapterDoc = chapters[chapterIndex];
	if (!chapterDoc) throw new Error(`Chapter not found: ${chapterIndex}`);
	const { personas, topicTitle } = await getTopicContext(topicId);
	// 全章のターンを時系列で結合し、永続キューと合わせて討論状態を導出する
	const existingTurns = await getDebateTurnsByTopicId(topicId);
	const persistedQueuedIntents = await loadQueuedIntents(topicId, chapterDoc.id);
	const state = getDebateState(existingTurns, personas, persistedQueuedIntents);
	state.runId = runId; // 世代照合用の runId を載せる（古い世代のタスクの追記を弾くため）
	// 章ローカルの進捗（quietStreak / 論点ステータス）を復元して state に載せる
	const progress = await loadChapterProgress(topicId, chapterDoc.id, chapterDoc);
	state.discussionPoints = progress.discussionPointStatuses;
	return {
		chapters,
		chapterDoc,
		chapter: chapterDoc,
		personas,
		topicTitle,
		state,
		// 全ターン数 − この章のターン数 = この章が state.turns 内で始まる位置
		chapterTurnStartInState: existingTurns.length - chapterDoc.turns.length,
		quietStreak: progress.quietStreak,
		// 単章モード、または最後の章なら最終章扱い
		isLastChapter: !!singleChapterMode || chapterIndex >= chapters.length - 1
	};
};

/**
 * 次ステップのタスクを投入する。override で stepKind/位置などを差し替えたペイロードを作り、
 * (runId, chapterId, frontier) から決まる決定的なタスクキーで重複投入を防ぐ（同じ frontier への
 * 二重起動は ALREADY_EXISTS で弾かれる）。comments ステップだけは frontier を 'comments' 固定にする。
 */
const enqueueStep = async (
	payload: TurnStepPayload,
	chapterId: string,
	override: Partial<TurnStepPayload>
): Promise<void> => {
	const next: TurnStepPayload = { ...payload, ...override };
	const frontier: number | 'comments' =
		next.stepKind === 'comments' ? 'comments' : next.expectedTurnIndex;
	await enqueueTurnStep(next, taskKey({ runId: next.runId, chapterId, frontierIndex: frontier }));
};

/** ターン後の次ステップ（turn/summary/closing）を最新状態の decideNextStep から投入する */
const enqueueAfterTurn = async (
	ctx: StepContext,
	payload: TurnStepPayload,
	quietStreak: number
): Promise<void> => {
	if (ctx.chapterDoc.status === 'completed') return;
	const next = decideNextStep({
		chapterTurns: ctx.state.turns.slice(ctx.chapterTurnStartInState),
		globalTurnCount: ctx.state.turns.length,
		quietStreak,
		discussionPoints: ctx.state.discussionPoints,
		chapterIndex: payload.chapterIndex,
		options: buildStepOptions(payload),
		isLastChapter: ctx.isLastChapter
	});
	if (next.kind === 'none') return;
	await enqueueStep(payload, ctx.chapterDoc.id, {
		stepKind: next.kind,
		expectedTurnIndex: 'expectedTurnIndex' in next ? next.expectedTurnIndex : 0,
		finalResponse: next.kind === 'turn' ? next.finalResponse : undefined
	});
};

/** 章末（最終応答ターンの直後）に summary（非最終章）/ closing（最終章）を現在の章ローカル位置へ投入する */
const enqueueChapterEnd = async (ctx: StepContext, payload: TurnStepPayload): Promise<void> => {
	const idx = ctx.state.turns.length - ctx.chapterTurnStartInState;
	await enqueueStep(payload, ctx.chapterDoc.id, {
		stepKind: ctx.isLastChapter ? 'closing' : 'summary',
		expectedTurnIndex: idx,
		finalResponse: undefined
	});
};

/** rejected/競合時に最新の永続状態から次ステップを再導出して投入する（liveness 保証） */
const resumeFromFresh = async (payload: TurnStepPayload): Promise<void> => {
	const ctx = await loadStepContext(payload);
	await enqueueAfterTurn(ctx, payload, ctx.quietStreak);
};

/**
 * 1ターンを実行する（旧 while ループの executeTurn に相当）。話者選択・介入・発言生成・
 * 永続化・統計更新までを担う。quietStreak を継続シグナルから決め、追記と同一トランザクションで書き込む。
 * freeze=true（章末 +1 最終応答）のときは quietStreak を据え置き、簡略フローで実行する。
 */
const executeTurn = async ({
	topicId,
	personas,
	chapter,
	chapterId,
	state,
	chapterTurnStartInState,
	interventionCooldown,
	quietStreak,
	freeze
}: {
	topicId: string;
	personas: Persona[];
	chapter: Chapter;
	chapterId: string;
	state: DebateState;
	chapterTurnStartInState: number;
	interventionCooldown: number;
	quietStreak: number;
	freeze: boolean;
}): Promise<{ committed: boolean; quietStreak: number }> => {
	// この章ぶんのターン列を切り出すヘルパ（state.turns は全章を含むため）
	const getChapterTurns = (): DebateTurn[] => state.turns.slice(chapterTurnStartInState);
	// 末尾ターンが誰かを指名していれば、その指名先（次に応答すべき人）
	const targetPersona = getLastTargetPersona(state.turns);

	// 章末 +1 最終応答: 旧ループの章末ブロックと等価（expire/addQueue を行わず固定の指名先に応答させる）
	// 話者選択・介入・キュー更新を一切挟まず、指名された人にそのまま1回だけ答えさせる簡略フロー
	if (freeze && targetPersona) {
		const speakerSelection: SpeakerSelection = {
			personaId: targetPersona.personaId,
			reason:
				targetPersona.targetedBy === 'facilitator'
					? 'targeted_by_facilitator'
					: 'targeted_by_persona'
		};
		const engagements = await evaluateEngagements({
			topicId,
			chapterId,
			personas,
			state,
			chapterTurns: getChapterTurns()
		});
		const engagement = await evaluateEngagementWithFallback({
			personaId: speakerSelection.personaId,
			personas,
			chapterTurns: getChapterTurns(),
			engagements
		});
		const reply = await generatePersonaTurn({
			topicId,
			personas,
			chapter,
			state,
			speakerSelection,
			engagement,
			chapterTurnStartIndex: chapterTurnStartInState,
			progressPatch: { quietStreak } // freeze 中は quietStreak を据え置く
		});
		if (!reply) return { committed: false, quietStreak }; // 追記競合・討論停止 → 未コミット
		// 発言後の共通後処理: 消化したキューを除去 → 発言統計を更新 → 信念変化があれば永続化
		await consumeQueuedIntent({
			topicId,
			chapterId,
			state,
			personaId: reply.personaId,
			queuedEntries: reply.queuedEntries
		});
		updateSpeakerStats({ state, personas, personaId: reply.personaId });
		if (reply.beliefChange)
			await applyBeliefChange({
				topicId,
				persona: personas.find((p) => p.id === reply.personaId)!,
				turnId: reply.turnId,
				beliefChange: reply.beliefChange
			});
		return { committed: true, quietStreak };
	}

	// --- 通常ターン ---
	// 失効したキューを掃除し、全ペルソナの意欲を評価する
	await expireQueuedIntents({ topicId, chapterId, state });
	const engagements = await evaluateEngagements({
		topicId,
		chapterId,
		personas,
		state,
		chapterTurns: getChapterTurns()
	});

	// ファシリテーター介入（target がない場合のみ）。介入は継続扱いで quietStreak を 0 にする
	if (!targetPersona) {
		const intervened = await tryIntervention({
			topicId,
			personas,
			chapter,
			chapterId,
			state,
			engagements,
			interventionCooldown,
			chapterTurns: getChapterTurns(),
			chapterTurnStartIndex: chapterTurnStartInState,
			progressPatch: { quietStreak: 0 }
		});
		if (intervened) {
			await saveDiscussionPointStatuses(topicId, chapterId, state);
			return { committed: true, quietStreak: 0 };
		}
	}

	// 次の話者を決定（指名 > キュー > スコア）し、選ばれなかった意欲者の意図はキューに積む
	const speakerSelection = selectSpeaker({ targetPersona, engagements, state, personas });
	await addQueuedIntents({
		topicId,
		chapterId,
		state,
		engagements,
		speakerSelection,
		triggerTurnId: state.turns[state.turns.length - 1]?.id ?? ''
	});
	// 選ばれた話者の意欲（一括評価に無ければ個別評価）を取得する
	const engagement = await evaluateEngagementWithFallback({
		personaId: speakerSelection.personaId,
		personas,
		chapterTurns: getChapterTurns(),
		engagements
	});
	// 盛り上がり判定: 高意欲者がいれば連続カウントを 0 リセット、いなければ +1（早期終了に近づく）
	const shouldContinue =
		engagements.length === 0 || engagements.some((a) => a.score >= CONTINUE_CHAPTER_THRESHOLD);
	const nextEndCount = shouldContinue ? 0 : quietStreak + 1;

	const reply = await generatePersonaTurn({
		topicId,
		personas,
		chapter,
		state,
		speakerSelection,
		engagement,
		chapterTurnStartIndex: chapterTurnStartInState,
		progressPatch: { quietStreak: nextEndCount }
	});
	if (!reply) return { committed: false, quietStreak }; // 追記競合・討論停止 → 未コミット
	// 発言後の共通後処理: 消化したキューを除去 → 発言統計を更新 → 信念変化があれば永続化
	await consumeQueuedIntent({
		topicId,
		chapterId,
		state,
		personaId: reply.personaId,
		queuedEntries: reply.queuedEntries
	});
	updateSpeakerStats({ state, personas, personaId: reply.personaId });
	if (reply.beliefChange)
		await applyBeliefChange({
			topicId,
			persona: personas.find((p) => p.id === reply.personaId)!,
			turnId: reply.turnId,
			beliefChange: reply.beliefChange
		});
	return { committed: true, quietStreak: nextEndCount };
};

/** open ステップ: オープニング/導入のファシリテーターターンを追記し、最初の turn ステップを投入する */
const performOpenStep = async (ctx: StepContext, payload: TurnStepPayload): Promise<boolean> => {
	const { chapterDoc, chapter, personas, topicTitle, state, chapterTurnStartInState } = ctx;
	const { topicId, chapterIndex } = payload;

	const enqueueFirstTurn = async (): Promise<void> => {
		const idx = state.turns.length - chapterTurnStartInState;
		await enqueueStep(payload, chapterDoc.id, { stepKind: 'turn', expectedTurnIndex: idx });
	};

	// frontier: 章が空のときのみ開始処理する。既に開始済み/完了なら turn を投入して resume
	if (chapterDoc.turns.length !== 0 || chapterDoc.status === 'completed') {
		await enqueueFirstTurn();
		return false;
	}

	// 章を running にし、論点をすべて untouched で初期化して保存する
	await updateChapterStatus(topicId, chapterDoc.id, 'running');
	state.discussionPoints = (chapter.discussionPoints ?? []).map((point) => ({
		point,
		status: 'untouched' as const
	}));
	await saveDiscussionPointStatuses(topicId, chapterDoc.id, state);

	// 第1章は討論全体のオープニング、それ以外は章の導入をファシリテーターに生成させる
	if (chapterIndex === 0) {
		const openingResult = await generateOpening(topicTitle, personas, chapter);
		if (!openingResult.ok) throw new Error(pipelineErrorMessage(openingResult.error));
		const fac = await generateFacilitatorTurn({
			topicId,
			state,
			chapterId: chapterDoc.id,
			content: openingResult.value.content ?? '',
			targetPersonaId: validPersonaId(openingResult.value.targetPersonaId, personas),
			chapterTurnStartIndex: chapterTurnStartInState
		});
		if (fac.status === 'committed') {
			markIntroduced(state, openingResult.value.selectedDiscussionPointIndex);
			await saveDiscussionPointStatuses(topicId, chapterDoc.id, state);
		}
	} else {
		const introResult = await generateChapterIntroduction(chapter, personas);
		if (introResult.ok) {
			const fac = await generateFacilitatorTurn({
				topicId,
				state,
				chapterId: chapterDoc.id,
				content: introResult.value.content ?? '',
				targetPersonaId: validPersonaId(introResult.value.targetPersonaId, personas),
				chapterTurnStartIndex: chapterTurnStartInState
			});
			if (fac.status === 'committed') {
				markIntroduced(state, introResult.value.selectedDiscussionPointIndex);
				await saveDiscussionPointStatuses(topicId, chapterDoc.id, state);
			}
		}
	}

	await enqueueFirstTurn();
	return true;
};

/** turn ステップ: frontier 一致なら1ターン生成→冪等追記→次ステップ投入。不一致/rejected は resume */
const performTurnStep = async (ctx: StepContext, payload: TurnStepPayload): Promise<boolean> => {
	const { chapterDoc, chapter, personas, state, chapterTurnStartInState, quietStreak } = ctx;
	const { topicId } = payload;
	const options = buildStepOptions(payload);
	const chapterLocalCount = chapterDoc.turns.length;
	const freeze = !!payload.finalResponse; // 章末 +1 最終応答は quietStreak を据え置く

	if (chapterDoc.status === 'completed') return false;

	// frontier 不一致（並走の敗者・既に前進済み）→ 生成しない。
	// 最終応答ステップなら +1 は済んでいるので summary/closing へ直行、通常ステップは resume
	if (chapterLocalCount !== payload.expectedTurnIndex) {
		if (freeze) await enqueueChapterEnd(ctx, payload);
		else await enqueueAfterTurn(ctx, payload, quietStreak);
		return false;
	}

	const result = await executeTurn({
		topicId,
		personas,
		chapter,
		chapterId: chapterDoc.id,
		state,
		chapterTurnStartInState,
		interventionCooldown: options.interventionCooldown,
		quietStreak,
		freeze
	});
	if (!result.committed) {
		await resumeFromFresh(payload);
		return false;
	}

	// 最終応答（+1）の直後は decideNextStep を再評価せず、そのまま章末（summary/closing）へ進む
	if (freeze) {
		await enqueueChapterEnd(ctx, payload);
		return true;
	}

	let finalEndCount = result.quietStreak;
	// 早期終了の手前で論点カバレッジを再確認する。
	// 盛り上がりが落ちて早期終了しそうでも、明示的に話されないまま実は消化された論点を拾い上げ、
	// それでも未消化が残るなら quietStreak を 0 に戻して章を続行させる（取りこぼし防止）
	const chapterTurnCountNow = state.turns.length - chapterTurnStartInState;
	if (
		chapterTurnCountNow >= Math.ceil(options.turnsPerChapter * EARLY_END_PROGRESS_RATIO) &&
		finalEndCount >= QUIET_STREAK_LIMIT
	) {
		const incomplete = state.discussionPoints.filter((p) => p.status !== 'addressed');
		if (incomplete.length > 0) {
			// LLM に「未消化論点のうち実際には議論された index」を判定させる
			const coverageResult = await evaluateDiscussionPointCoverage(
				state.turns.slice(chapterTurnStartInState),
				incomplete.map((p) => p.point),
				personas
			);
			if (coverageResult.ok) {
				// 実は議論済みと判定された論点を addressed に更新する
				for (const idx of coverageResult.value) {
					const target = state.discussionPoints.find((p) => p.point === incomplete[idx]?.point);
					if (target) target.status = 'addressed';
				}
				await saveDiscussionPointStatuses(topicId, chapterDoc.id, state);
				// まだ未消化が残るなら早期終了を取り消して継続（quietStreak リセット）
				if (state.discussionPoints.some((p) => p.status !== 'addressed')) {
					finalEndCount = 0;
					await db().doc(`topics/${topicId}/chapters/${chapterDoc.id}`).update({ quietStreak: 0 });
				}
			}
		}
	}

	// 確定した quietStreak をもとに次ステップ（turn / summary / closing）を投入する
	await enqueueAfterTurn(ctx, payload, finalEndCount);
	return true;
};

/** summary ステップ: 章まとめを追記し、章を完了として次章の open を投入する */
const performSummaryStep = async (ctx: StepContext, payload: TurnStepPayload): Promise<boolean> => {
	const { chapters, chapterDoc, chapter, personas, state, chapterTurnStartInState } = ctx;
	const { topicId, chapterIndex } = payload;

	if (chapterDoc.turns.length === payload.expectedTurnIndex && chapterDoc.status !== 'completed') {
		await generateChapterTransition({
			topicId,
			chapter,
			state,
			personas,
			chapterTurnStartIndex: chapterTurnStartInState
		});
	}
	await updateChapterStatus(topicId, chapterDoc.id, 'completed');
	await deleteDiscussionPointStatuses(topicId, chapterDoc.id);

	const nextChapter = chapters[chapterIndex + 1];
	if (nextChapter) {
		await enqueueStep(payload, nextChapter.id, {
			chapterIndex: chapterIndex + 1,
			stepKind: 'open',
			expectedTurnIndex: 0
		});
	}
	return true;
};

/** closing ステップ: クロージングを追記し、章を完了として comments を投入する */
const performClosingStep = async (ctx: StepContext, payload: TurnStepPayload): Promise<boolean> => {
	const { chapterDoc, personas, state, chapterTurnStartInState } = ctx;
	const { topicId } = payload;

	if (chapterDoc.turns.length === payload.expectedTurnIndex && chapterDoc.status !== 'completed') {
		await appendClosingTurn({
			topicId,
			personas,
			state,
			chapterId: chapterDoc.id,
			chapterTurnStartIndex: chapterTurnStartInState
		});
	}
	await updateChapterStatus(topicId, chapterDoc.id, 'completed');
	await deleteDiscussionPointStatuses(topicId, chapterDoc.id);
	await enqueueStep(payload, chapterDoc.id, { stepKind: 'comments', expectedTurnIndex: -1 });
	return true;
};

/** comments ステップ: 事後コメント生成と phaseStatus 遷移（冪等・終端） */
const performCommentsStep = async (
	ctx: StepContext,
	payload: TurnStepPayload
): Promise<boolean> => {
	await persistPostDebateComments({
		topicId: payload.topicId,
		personas: ctx.personas,
		state: ctx.state
	});
	return true;
};

/**
 * 1ステップを処理する再入可能ディスパッチャ。停止ゲート→状態再構築→stepKind 別処理を行う。
 * frontier の唯一勝者だけがターンを生成し、敗者・リトライは resume でチェーンを途切れさせない。
 * @returns 生成・追記したか（観測用）。停止/resume/rejected は false。
 */
export const advanceDebate = async (payload: TurnStepPayload): Promise<boolean> => {
	if (!(await isDebateActive(payload.topicId))) return false;
	const ctx = await loadStepContext(payload);
	switch (payload.stepKind) {
		case 'open':
			return performOpenStep(ctx, payload);
		case 'turn':
			return performTurnStep(ctx, payload);
		case 'summary':
			return performSummaryStep(ctx, payload);
		case 'closing':
			return performClosingStep(ctx, payload);
		case 'comments':
			return performCommentsStep(ctx, payload);
	}
};
