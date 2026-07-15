/**
 * 討論を「1ステップ＝1 Cloud Task」のチェーンとして駆動するチェーン駆動層。
 *
 * 各章は open → turn(複数) → chapter-end という step の連鎖で進む。
 * advanceDebate が停止ゲート→状態再構築→オプション構築→stepKind の dispatch を行い、
 * dispatch した stepKind と step 層が返した実行結果から次ステップを決定して enqueue する。
 * そのタスクが起動して再び advanceDebate を呼ぶ…という自己継続ループになっている。
 * 状態は毎回 Firestore（永続データ）から再構築するため、各ステップはメモリ上の状態を引き継がず、
 * いつ・何回起動されても同じ結果になる（冪等・再入可能）。
 *
 * 並走対策として「frontier（章ローカルのターン数 expectedTurnIndex）」を使う。複数タスクが同じ
 * frontier を狙っても、追記トランザクションで勝てるのは1つだけ。敗者・リトライは resume で
 * 最新状態から次ステップを再投入し、チェーンが途切れないようにする（liveness 保証）。
 *
 * 依存方向は一方向（orchestrator → step）。step 層は当ファイルに依存しない。
 */
import { getTopicById } from '../topics/topics.js';
import { getPersonasByTopicId } from '../personas/personas.js';
import { getDebateState } from './debate-state.js';
import { loadChapterProgress, getChaptersByTopicId, getDebateTurnsByTopicId } from './chapter.js';
import { checkDebateActivation, confirmDebateGenerated } from './debate-lifecycle.js';
import { enqueueStep, taskKey } from './enqueue-step.js';
import {
	TURN_CAP_RATIO,
	AGENDA_TURN_CAP_RATIO,
	TURNS_PER_CHAPTER,
	MAX_TURNS,
	DEFAULT_INTERVENTION_COOLDOWN
} from '../../constants/debate.constants.js';
import { isEarlyEndCandidate } from './utils.js';
import { loadQueuedIntents } from './queued-intents.js';
import { performOpenStep, performTurnStep, completeChapterStep } from './step.js';
import type { DebateOptions } from '../../types/debate.types.js';
import type { AgendaItemState } from '../../types/chapter.types.js';
import type { DebateTurn } from '../../types/turn.types.js';
import type { NextStep, StepPayload, StepContext } from '../../types/step.types.js';

export const DEFAULT_OPTIONS: DebateOptions = {
	turnsPerChapter: TURNS_PER_CHAPTER,
	maxTurns: MAX_TURNS,
	interventionCooldown: DEFAULT_INTERVENTION_COOLDOWN
};

/** 章ローカルの永続ターン末尾に未応答の指名（直接質問）が残っているか判定する */
const hasUnansweredTargetAtEnd = (chapterTurns: DebateTurn[]): boolean => {
	const last = chapterTurns[chapterTurns.length - 1];
	return !!(last?.targetPersonaId && last.targetedBy);
};

/** decideNextStep が返しうる種別（turn 継続 / 章末 chapter-end）。open は返さない。 */
type TurnFollowupStep = Extract<NextStep, { kind: 'turn' | 'chapter-end' }>;

/**
 * 追記成功後、永続状態のみから次ステップ種別と期待位置を決める純関数。
 * while ループ版と等価な規則（cap・早期終了・最終応答 +1）で判定する。
 * 乱数・時刻・外部 I/O に依存しないため、同じ frontier を観測した複数の enqueuer が同一結果を計算する。
 */
export const decideNextStep = ({
	chapterTurns,
	globalTurnCount,
	quietStreak,
	agenda,
	options
}: {
	chapterTurns: DebateTurn[];
	globalTurnCount: number;
	quietStreak: number;
	agenda: AgendaItemState[];
	options: DebateOptions;
}): TurnFollowupStep => {
	// 論点リストを持つ章は消化のため上限を高めに取る（AGENDA_TURN_CAP_RATIO > TURN_CAP_RATIO）
	const hasPoints = agenda.length > 0;
	// この章の強制終了ターン数。目標ターン数 × 比率で算出する
	const cap = Math.ceil(
		options.turnsPerChapter * (hasPoints ? AGENDA_TURN_CAP_RATIO : TURN_CAP_RATIO)
	);
	const chapterTurnCount = chapterTurns.length;
	// 次に追記すべき章ローカル位置（= 現在のターン数）。frontier 照合に使う
	const expectedTurnIndex = chapterTurnCount;

	// 章上限に到達、または討論全体の上限に到達したか（cap は最優先のハード終了条件）
	const hitCap = chapterTurnCount >= cap || globalTurnCount >= options.maxTurns;
	// 一定割合まで進み、かつ盛り上がりが連続して低いなら早期終了（判定式は isEarlyEndCandidate に一本化）
	const earlyEnd = isEarlyEndCandidate(chapterTurnCount, options.turnsPerChapter, quietStreak);
	// 章の全 agendaItem が消化済み（addressed）なら盛り上がりに関わらず章を終了する。
	// 論点を持たない章には適用しない（hasPoints ガード）。（4.1/4.3/4.4）
	const allAddressed = hasPoints && agenda.every((item) => item.status === 'addressed');

	// まだ終了条件に達していなければ、通常のターンを続ける
	if (!hitCap && !earlyEnd && !allAddressed) {
		return { kind: 'turn', expectedTurnIndex };
	}

	// 章終了と判定。末尾に未応答の指名が残れば最終応答ターン（+1）を1回挟む。
	// finalResponse フラグで標識し、当該ターン後は decideNextStep を再評価せず chapter-end へ直行する
	if (hasUnansweredTargetAtEnd(chapterTurns)) {
		return { kind: 'turn', expectedTurnIndex, finalResponse: true };
	}

	return { kind: 'chapter-end', expectedTurnIndex };
};

/**
 * トピック名と採用ペルソナを取得する（討論に参加するのは selected なペルソナのみ）。
 * 事実基盤を含む同名の pipeline/topics/topic-context.ts の getTopicContext とは別物のため名前で区別する。
 */
const loadTopicParticipants = async (topicId: string) => {
	const [topic, allPersonas] = await Promise.all([
		getTopicById(topicId),
		getPersonasByTopicId(topicId)
	]);
	if (!topic) throw new Error(`Topic not found: ${topicId}`);
	return { topicTitle: topic.title, personas: allPersonas.filter((persona) => persona.selected) };
};

/** 既定オプションにペイロード由来の単章モードを重ねた実行オプションを作る */
const buildStepOptions = (payload: StepPayload): DebateOptions => ({
	...DEFAULT_OPTIONS,
	singleChapterMode: payload.singleChapterMode
});

/** ステップ起動時に永続データのみから状態と章進捗を再構築する */
const loadStepContext = async (payload: StepPayload): Promise<StepContext> => {
	const { topicId, chapterIndex, runId, singleChapterMode } = payload;
	const chapters = await getChaptersByTopicId(topicId);
	if (!chapters.length) throw new Error('Chapters not found');
	const chapterDoc = chapters[chapterIndex];
	if (!chapterDoc) throw new Error(`Chapter not found: ${chapterIndex}`);
	const { personas, topicTitle } = await loadTopicParticipants(topicId);
	// 全章のターンを時系列で結合し、永続キューと章ローカル進捗（quietStreak / 論点ステータス）を復元する
	const existingTurns = await getDebateTurnsByTopicId(topicId);
	const persistedQueuedIntents = await loadQueuedIntents(topicId, chapterDoc.id);
	const progress = await loadChapterProgress(topicId, chapterDoc.id, chapterDoc);
	// 論点ステータスを含めて状態を一度に組成する（空返し→後付けミューテートを避ける）
	const state = getDebateState(
		existingTurns,
		personas,
		persistedQueuedIntents,
		progress.agendaItemStatuses
	);
	state.runId = runId; // 世代照合用の runId を載せる（古い世代のタスクの追記を弾くため）
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
 * 二重起動は ALREADY_EXISTS で弾かれる）。frontier は全ステップ共通で章ローカル期待位置を使う。
 */
const enqueueNextStep = async (
	payload: StepPayload,
	chapterId: string,
	override: Partial<StepPayload>
): Promise<void> => {
	const next: StepPayload = { ...payload, ...override };
	await enqueueStep(
		next,
		taskKey({ runId: next.runId, chapterId, frontierIndex: next.expectedTurnIndex })
	);
};

/** open 完了後の最初の turn を、handler が更新した state から算出した章ローカル位置へ投入する */
const enqueueFirstTurn = async (ctx: StepContext, payload: StepPayload): Promise<void> => {
	const turnIndex = ctx.state.turns.length - ctx.chapterTurnStartInState;
	await enqueueNextStep(payload, ctx.chapterDoc.id, {
		stepKind: 'turn',
		expectedTurnIndex: turnIndex
	});
};

/** ターン後の次ステップ（turn/summary/closing）を最新状態の decideNextStep から投入する */
const enqueueAfterTurn = async (
	ctx: StepContext,
	payload: StepPayload,
	quietStreak: number
): Promise<void> => {
	if (ctx.chapterDoc.status === 'completed') return;
	const next = decideNextStep({
		chapterTurns: ctx.state.turns.slice(ctx.chapterTurnStartInState),
		globalTurnCount: ctx.state.turns.length,
		quietStreak,
		agenda: ctx.state.agenda,
		options: buildStepOptions(payload)
	});
	await enqueueNextStep(payload, ctx.chapterDoc.id, {
		stepKind: next.kind,
		expectedTurnIndex: next.expectedTurnIndex,
		finalResponse: next.kind === 'turn' ? next.finalResponse : undefined
	});
};

/** 章末（最終応答ターンの直後）に chapter-end を現在の章ローカル位置へ投入する */
const enqueueChapterEnd = async (ctx: StepContext, payload: StepPayload): Promise<void> => {
	const turnIndex = ctx.state.turns.length - ctx.chapterTurnStartInState;
	await enqueueNextStep(payload, ctx.chapterDoc.id, {
		stepKind: 'chapter-end',
		expectedTurnIndex: turnIndex,
		finalResponse: undefined
	});
};

/** rejected/競合時に最新の永続状態から次ステップを再導出して投入する（liveness 保証） */
const resumeFromFresh = async (payload: StepPayload): Promise<void> => {
	const ctx = await loadStepContext(payload);
	await enqueueAfterTurn(ctx, payload, ctx.quietStreak);
};

/**
 * 章を completed 化し、最終章なら討論を generated 確定、非最終章なら次章 open を投入する（冪等・終端配線）。
 * chapter-end ステップと、committed-no-turn（最後の論点消化のみ）のインライン終了の両方から呼ぶ。
 */
const finalizeChapterEnd = async (ctx: StepContext, payload: StepPayload): Promise<boolean> => {
	const committed = await completeChapterStep(ctx, payload);
	if (ctx.isLastChapter) {
		// 最終章: コメント生成に依存せず討論を generated 確定して終端する（enqueue なし）
		await confirmDebateGenerated(payload.topicId);
	} else {
		// 非最終章: 次章の open を投入して討論を継続する
		const nextChapter = ctx.chapters[payload.chapterIndex + 1];
		if (nextChapter) {
			await enqueueNextStep(payload, nextChapter.id, {
				chapterIndex: payload.chapterIndex + 1,
				stepKind: 'open',
				expectedTurnIndex: 0
			});
		}
	}
	return committed;
};

/** turn を dispatch し、実行結果と payload.finalResponse から次ステップを投入する */
const advanceTurn = async (
	ctx: StepContext,
	payload: StepPayload,
	options: DebateOptions
): Promise<boolean> => {
	const exec = await performTurnStep(ctx, payload, options);
	// 既に完了した章に当たった turn タスク。committed-no-turn がインライン終了した後のリトライでも、
	// 次段（次章 open / generated 確定）を確実に投入してチェーンを途切れさせない（冪等）。
	if (exec.status === 'completed') {
		await finalizeChapterEnd(ctx, payload);
		return false;
	}
	// 生成中に世代交代が起きて addTurn が弾いた場合は、旧世代タスクなので resume せず終了する（R9.2/9.3）
	if (exec.status === 'stale_generation') return false;
	if (exec.status === 'conflict') {
		await resumeFromFresh(payload);
		return false;
	}
	// 最後の論点が出尽くし・発言なし（committed-no-turn）。frontier は前進しないため enqueue 経由では
	// 同一キー衝突で章末に到達できない。余計な発言を挟まずその場で章終了を配線する（4.1）。
	if (exec.status === 'chapter-exhausted') {
		return finalizeChapterEnd(ctx, payload);
	}
	// advanced: 実行コミット or frontier 前進。最終応答の直後は章末へ直行、通常は decideNextStep へ
	if (payload.finalResponse) await enqueueChapterEnd(ctx, payload);
	else await enqueueAfterTurn(ctx, payload, exec.quietStreak);
	// 生成・追記したのは frontier 一致時のみ（不一致は前進済みで未生成）。返り値の意味は分割前と同一
	return (
		ctx.chapterDoc.status !== 'completed' &&
		ctx.chapterDoc.turns.length === payload.expectedTurnIndex
	);
};

/**
 * 1ステップを処理する再入可能ディスパッチャ。停止ゲート→状態再構築→オプション構築→
 * stepKind の dispatch を行い、dispatch した stepKind と実行結果から次ステップを決定・投入する。
 * frontier の唯一勝者だけがターンを生成し、敗者・リトライは resume でチェーンを途切れさせない。
 * @returns 生成・追記したか（観測用）。停止/resume/rejected は false。
 */
export const advanceDebate = async (payload: StepPayload): Promise<boolean> => {
	// 入口ゲート: 停止判定と世代照合を1回の topic doc 読みで行う。旧世代タスクは副作用ゼロで正常終了する。
	const activation = await checkDebateActivation(payload.topicId, payload.runId);
	if (activation.status === 'stale_generation') {
		console.info('[advanceDebate] stale generation skipped', {
			topicId: payload.topicId,
			payloadRunId: payload.runId,
			currentRunId: activation.currentRunId,
			stepKind: payload.stepKind
		});
		return false;
	}
	if (activation.status !== 'active') return false;
	const ctx = await loadStepContext(payload);
	const options = buildStepOptions(payload);
	switch (payload.stepKind) {
		case 'open': {
			const committed = await performOpenStep(ctx, payload);
			// 開始処理の有無に関わらず最初の turn を投入する（既開始時の resume 含む）
			await enqueueFirstTurn(ctx, payload);
			return committed;
		}
		case 'turn':
			return advanceTurn(ctx, payload, options);
		case 'chapter-end':
			// 章を completed 化し論点状態をクリーンアップして次段を配線する（発話生成なし）
			return finalizeChapterEnd(ctx, payload);
	}
};
