/**
 * 討論チェーンの「1ステップ実行」層。
 *
 * 各 stepKind（open / turn / summary / closing / comments）の処理本体を担い、
 * 自分のステップの生成・冪等追記だけを行って「実行結果」を返す。次に何をするか
 * （decideNextStep の呼び出しや enqueue）はこの層では決めず、チェーン駆動層
 * （debate-orchestrator.ts）が dispatch した stepKind と実行結果から決める。
 *
 * この一方向（orchestrator → step）により、step 層は debate-orchestrator.ts に依存しない。
 * handler は受け取った ctx・options のみで実行し、ctx.state を破壊的に更新する。
 * その更新後の状態を基に orchestrator が次ステップを enqueue する（frontier 算出も orchestrator 側）。
 */
import { updateChapterStatus } from './chapter.js';
import {
	generateOpening,
	generateChapterIntroduction,
	evaluateDiscussionPointCoverage
} from '../../agents/facilitator-agent.js';
import { selectSpeaker } from './speaker-selection.js';
import {
	QUIET_STREAK_LIMIT,
	EARLY_END_PROGRESS_RATIO,
	CONTINUE_CHAPTER_THRESHOLD,
	PERSONA_CHAIN_INTERVENTION_COOLDOWN
} from '../../constants/debate.constants.js';
import { evaluateEngagements, evaluateEngagementWithFallback } from './engagement.js';
import { expireQueuedIntents, addQueuedIntents, consumeQueuedIntent } from './queued-intents.js';
import {
	initDiscussionPoints,
	markIntroduced,
	markAddressed,
	recordSpeakerOnActivePoint,
	saveDiscussionPointStatuses,
	deleteDiscussionPointStatuses
} from './discussion-points.js';
import {
	tryIntervention,
	countConsecutivePersonaTargets,
	type InterventionTrigger
} from './intervention.js';
import { applyBeliefChange } from './belief.js';
import { updateSpeakerStats } from './debate-state.js';
import { persistPostDebateComments } from './post-debate-comments.js';
import {
	generateFacilitatorTurn,
	generatePersonaTurn,
	generateChapterTransition,
	appendClosingTurn
} from './turn.js';
import { pipelineErrorMessage, validPersonaId } from './utils.js';
import type {
	SpeakerSelection,
	DebateState,
	DebateOptions,
	Engagement
} from '../../types/debate.types.js';
import type { DebateTurn } from '../../types/turn.types.js';
import type { StepPayload, StepContext, TurnExecution } from '../../types/step.types.js';
import type { Chapter } from '../../types/chapter.types.js';
import type { Persona } from '../../types/persona.types.js';
import { getFirestore } from 'firebase-admin/firestore';

const db = () => getFirestore();

/** 関連参加者IDを参加者リストの有効IDへフィルタする（記録前の前処理。未指定は undefined のまま） */
const filterValidPersonaIds = (
	ids: string[] | undefined,
	personas: Persona[]
): string[] | undefined => ids?.filter((id) => personas.some((p) => p.id === id));

/** 末尾ターンが誰かを指名（直接質問）していれば、その指名先と指名元を返す。なければ undefined */
const getLastTargetPersona = (
	turns: DebateTurn[]
): { personaId: string; targetedBy: 'facilitator' | 'persona' } | undefined => {
	const last = turns[turns.length - 1];
	if (!last?.targetPersonaId || !last.targetedBy) return undefined;
	return { personaId: last.targetPersonaId, targetedBy: last.targetedBy };
};

/**
 * 発言コミット後の共通後処理: 消化したキューを除去 → 発言統計を更新 → 信念変化があれば永続化。
 * executeTurn の freeze 分岐と通常分岐の両方から、コミット成功時に同一の手順で呼ぶ。
 */
const finalizeCommittedTurn = async ({
	topicId,
	chapterId,
	state,
	personas,
	reply
}: {
	topicId: string;
	chapterId: string;
	state: DebateState;
	personas: Persona[];
	reply: NonNullable<Awaited<ReturnType<typeof generatePersonaTurn>>>;
}): Promise<void> => {
	await consumeQueuedIntent({
		topicId,
		chapterId,
		state,
		personaId: reply.personaId,
		queuedEntries: reply.queuedEntries
	});
	updateSpeakerStats({ state, personas, personaId: reply.personaId });
	// 立場カバレッジ: 現アクティブ論点の発言済み集合へ話者を冪等記録し、永続型からそのまま書き出す
	// （Partial転送形を介さず state ベースで永続化。集合のため resume 後も二重化しない）
	recordSpeakerOnActivePoint(state, reply.personaId);
	await saveDiscussionPointStatuses(topicId, chapterId, state);
	if (reply.beliefChange)
		await applyBeliefChange({
			topicId,
			persona: personas.find((p) => p.id === reply.personaId)!,
			turnId: reply.turnId,
			beliefChange: reply.beliefChange
		});
};

/**
 * 盛り上がり判定: 高意欲者がいれば連続カウントを 0 リセット、いなければ +1（早期終了に近づく）。
 * engagements から純粋に次 quietStreak を算出する（算出式は不変）。
 */
const decideQuietStreak = (engagements: Engagement[], quietStreak: number): number => {
	const shouldContinue =
		engagements.length === 0 || engagements.some((a) => a.score >= CONTINUE_CHAPTER_THRESHOLD);
	return shouldContinue ? 0 : quietStreak + 1;
};

/**
 * 1ターンを実行する（旧 while ループの executeTurn に相当）。話者選択・介入・発言生成・
 * 永続化・統計更新までを担う。quietStreak を継続シグナルから決め、追記と同一トランザクションで書き込む。
 * freeze=true（章末 +1 最終応答）のときは quietStreak を据え置き、簡略フローで実行する。
 */
const executeTurn = async ({
	topicId,
	topicTitle,
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
	topicTitle: string;
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
			topicTitle,
			personas,
			chapter,
			state,
			speakerSelection,
			engagement,
			chapterTurnStartIndex: chapterTurnStartInState,
			progressPatch: { quietStreak } // freeze 中は quietStreak を据え置く
		});
		if (!reply) return { committed: false, quietStreak }; // 追記競合・討論停止 → 未コミット
		await finalizeCommittedTurn({ topicId, chapterId, state, personas, reply });
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

	// ファシリテーター介入を試みるトリガーを構築する。介入は継続扱いで quietStreak を 0 にする。
	// - target なし: 従来どおり no-target（drift→stall）。
	// - ペルソナ指名チェーン中: persona-chain（drift のみ・チェーン長をシグナルに）。
	// - facilitator 指名（章導入・前回介入の指名先）: 割り込まず指名先に応答させる（trigger なし）。
	const interventionTrigger: InterventionTrigger | undefined = !targetPersona
		? { kind: 'no-target' }
		: targetPersona.targetedBy === 'persona'
			? { kind: 'persona-chain', chainLength: countConsecutivePersonaTargets(getChapterTurns()) }
			: undefined;

	if (interventionTrigger) {
		// 指名チェーン経路は評価頻度を間引く（既定より長いクールダウン）。no-target は既定どおり。
		const triggerCooldown =
			interventionTrigger.kind === 'persona-chain'
				? PERSONA_CHAIN_INTERVENTION_COOLDOWN
				: interventionCooldown;
		const intervened = await tryIntervention({
			topicId,
			personas,
			chapter,
			chapterId,
			state,
			engagements,
			interventionCooldown: triggerCooldown,
			trigger: interventionTrigger,
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
	const nextEndCount = decideQuietStreak(engagements, quietStreak);

	const reply = await generatePersonaTurn({
		topicId,
		topicTitle,
		personas,
		chapter,
		state,
		speakerSelection,
		engagement,
		chapterTurnStartIndex: chapterTurnStartInState,
		progressPatch: { quietStreak: nextEndCount }
	});
	if (!reply) return { committed: false, quietStreak }; // 追記競合・討論停止 → 未コミット
	await finalizeCommittedTurn({ topicId, chapterId, state, personas, reply });
	return { committed: true, quietStreak: nextEndCount };
};

/**
 * open ステップ: オープニング/導入のファシリテーターターンを追記する。
 * @returns 開始処理を行ったか（既に開始済み/完了で何もしなければ false）。次の turn 投入は orchestrator が行う。
 */
export const performOpenStep = async (ctx: StepContext, payload: StepPayload): Promise<boolean> => {
	const { chapterDoc, chapter, personas, topicTitle, state, chapterTurnStartInState } = ctx;
	const { topicId, chapterIndex } = payload;

	// 章が空のときのみ開始処理する。既に開始済み/完了なら何もしない（orchestrator が turn を投入して resume）
	if (chapterDoc.turns.length !== 0 || chapterDoc.status === 'completed') {
		return false;
	}

	// 章を running にし、論点をすべて untouched で初期化して保存する
	await updateChapterStatus(topicId, chapterDoc.id, 'running');
	state.discussionPoints = initDiscussionPoints(chapter);
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
			markIntroduced(
				state,
				openingResult.value.selectedDiscussionPointIndex,
				filterValidPersonaIds(openingResult.value.relevantPersonaIds, personas)
			);
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
				markIntroduced(
					state,
					introResult.value.selectedDiscussionPointIndex,
					filterValidPersonaIds(introResult.value.relevantPersonaIds, personas)
				);
				await saveDiscussionPointStatuses(topicId, chapterDoc.id, state);
			}
		}
	}

	return true;
};

/**
 * 早期終了の手前で論点カバレッジを再確認・補正する。
 * 盛り上がりが落ちて早期終了しそうでも、明示的に話されないまま実は消化された論点を拾い上げ、
 * それでも未消化が残るなら quietStreak を 0 に戻して章を続行させる（取りこぼし防止）。
 * 発火条件・閾値・LLM 判定・addressed 更新は不変。補正後の quietStreak を返す。
 */
const reconcileEarlyEndCoverage = async ({
	topicId,
	chapterId,
	personas,
	state,
	chapterTurnStartInState,
	turnsPerChapter,
	quietStreak
}: {
	topicId: string;
	chapterId: string;
	personas: Persona[];
	state: DebateState;
	chapterTurnStartInState: number;
	turnsPerChapter: number;
	quietStreak: number;
}): Promise<number> => {
	const chapterTurnCountNow = state.turns.length - chapterTurnStartInState;
	if (
		!(
			chapterTurnCountNow >= Math.ceil(turnsPerChapter * EARLY_END_PROGRESS_RATIO) &&
			quietStreak >= QUIET_STREAK_LIMIT
		)
	) {
		return quietStreak;
	}
	const incomplete = state.discussionPoints.filter((p) => p.status !== 'addressed');
	if (incomplete.length === 0) return quietStreak;

	// LLM に「未消化論点のうち実際には議論された index」を判定させる
	const coverageResult = await evaluateDiscussionPointCoverage(
		state.turns.slice(chapterTurnStartInState),
		incomplete.map((p) => p.point),
		personas
	);
	if (!coverageResult.ok) return quietStreak;

	// 実は議論済みと判定された論点を addressed に更新する
	for (const idx of coverageResult.value) {
		const point = incomplete[idx]?.point;
		if (point !== undefined) markAddressed(state, point);
	}
	await saveDiscussionPointStatuses(topicId, chapterId, state);
	// まだ未消化が残るなら早期終了を取り消して継続（quietStreak リセット）
	if (state.discussionPoints.some((p) => p.status !== 'addressed')) {
		await db().doc(`topics/${topicId}/chapters/${chapterId}`).update({ quietStreak: 0 });
		return 0;
	}
	return quietStreak;
};

/**
 * turn ステップ: frontier 一致なら1ターン生成→冪等追記し、実行結果を返す。
 * 不一致（既に前進済み）は advanced、追記競合は conflict、章完了済みは completed を返す。
 * 次ステップの決定・投入は orchestrator が本結果と payload.finalResponse から行う。
 */
export const performTurnStep = async (
	ctx: StepContext,
	payload: StepPayload,
	options: DebateOptions
): Promise<TurnExecution> => {
	const { chapterDoc, chapter, personas, topicTitle, state, chapterTurnStartInState, quietStreak } =
		ctx;
	const { topicId } = payload;
	const chapterLocalCount = chapterDoc.turns.length;
	const freeze = !!payload.finalResponse; // 章末 +1 最終応答は quietStreak を据え置く

	if (chapterDoc.status === 'completed') return { status: 'completed' };

	// frontier 不一致（並走の敗者・既に前進済み）→ 生成しない。orchestrator が次ステップへ進める
	if (chapterLocalCount !== payload.expectedTurnIndex) {
		return { status: 'advanced', quietStreak };
	}

	const result = await executeTurn({
		topicId,
		topicTitle,
		personas,
		chapter,
		chapterId: chapterDoc.id,
		state,
		chapterTurnStartInState,
		interventionCooldown: options.interventionCooldown,
		quietStreak,
		freeze
	});
	if (!result.committed) return { status: 'conflict' };

	// 最終応答（+1）の直後は次ステップ判定を再評価せず、そのまま章末へ進む（orchestrator が判断）
	if (freeze) return { status: 'advanced', quietStreak: result.quietStreak };

	// 早期終了の手前で論点カバレッジを再確認・補正し、確定した quietStreak を得る
	const finalEndCount = await reconcileEarlyEndCoverage({
		topicId,
		chapterId: chapterDoc.id,
		personas,
		state,
		chapterTurnStartInState,
		turnsPerChapter: options.turnsPerChapter,
		quietStreak: result.quietStreak
	});

	// 確定した quietStreak を実行結果に載せる。これを基に orchestrator が次ステップを決める
	return { status: 'advanced', quietStreak: finalEndCount };
};

/**
 * summary ステップ: 章まとめを追記し、章を完了にする。
 * @returns 常に true（処理は冪等）。次章 open の投入は orchestrator が行う。
 */
export const performSummaryStep = async (
	ctx: StepContext,
	payload: StepPayload
): Promise<boolean> => {
	const { chapterDoc, chapter, personas, state, chapterTurnStartInState } = ctx;
	const { topicId } = payload;

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
	return true;
};

/**
 * closing ステップ: クロージングを追記し、章を完了にする。
 * @returns 常に true（処理は冪等）。comments の投入は orchestrator が行う。
 */
export const performClosingStep = async (
	ctx: StepContext,
	payload: StepPayload
): Promise<boolean> => {
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
	return true;
};

/** comments ステップ: 事後コメント生成と phaseStatus 遷移（冪等・終端） */
export const performCommentsStep = async (
	ctx: StepContext,
	payload: StepPayload
): Promise<boolean> => {
	await persistPostDebateComments({
		topicId: payload.topicId,
		personas: ctx.personas,
		state: ctx.state
	});
	return true;
};
