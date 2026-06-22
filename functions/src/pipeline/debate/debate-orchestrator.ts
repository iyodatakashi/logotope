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
	CHAPTER_END_COUNT_LIMIT,
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
	chapterEndCount,
	discussionPoints,
	options,
	isLastChapter
}: {
	chapterTurns: DebateTurn[];
	globalTurnCount: number;
	chapterEndCount: number;
	discussionPoints: DiscussionPointState[];
	chapterIndex: number;
	options: DebateOptions;
	isLastChapter: boolean;
}): NextStep => {
	const hasPoints = discussionPoints.length > 0;
	const cap = Math.ceil(
		options.turnsPerChapter * (hasPoints ? AGENDA_TURN_CAP_RATIO : TURN_CAP_RATIO)
	);
	const chapterTurnCount = chapterTurns.length;
	const expectedTurnIndex = chapterTurnCount;

	const hitCap = chapterTurnCount >= cap || globalTurnCount >= options.maxTurns;
	const earlyEnd =
		chapterTurnCount >= Math.ceil(options.turnsPerChapter * EARLY_END_PROGRESS_RATIO) &&
		chapterEndCount >= CHAPTER_END_COUNT_LIMIT;

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

const getTopicContext = async (topicId: string) => {
	const [topic, allPersonas] = await Promise.all([
		getTopicById(topicId),
		getPersonasByTopicId(topicId)
	]);
	if (!topic) throw new Error(`Topic not found: ${topicId}`);
	return { topicTitle: topic.title, personas: allPersonas.filter((p) => p.approved) };
};

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

const deleteDiscussionPointStatuses = async (topicId: string, chapterId: string): Promise<void> => {
	await db().doc(`topics/${topicId}/chapters/${chapterId}`).update({
		discussionPointStatuses: FieldValue.delete()
	});
};

const markIntroduced = (state: DebateState, index: number | undefined): void => {
	if (index === undefined) return;
	const untouched = state.discussionPoints.filter((p) => p.status !== 'addressed');
	const target =
		untouched[index] !== undefined
			? state.discussionPoints.find((p) => p.point === untouched[index].point)
			: undefined;
	if (target) target.status = 'introduced';
};

const getLastTargetPersona = (
	turns: DebateTurn[]
): { personaId: string; targetedBy: 'facilitator' | 'persona' } | undefined => {
	const last = turns[turns.length - 1];
	if (!last?.targetPersonaId || !last.targetedBy) return undefined;
	return { personaId: last.targetPersonaId, targetedBy: last.targetedBy };
};

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

const stepOptions = (payload: TurnStepPayload): DebateOptions => ({
	...DEFAULT_OPTIONS,
	singleChapterMode: payload.singleChapterMode
});

type StepContext = {
	chapters: ChapterEntry[];
	chapterDoc: ChapterEntry;
	chapter: Chapter;
	personas: Persona[];
	topicTitle: string;
	state: DebateState;
	chapterTurnStartInState: number;
	chapterEndCount: number;
	isLastChapter: boolean;
};

/** ステップ起動時に永続データのみから状態と章進捗を再構築する */
const loadStepContext = async (payload: TurnStepPayload): Promise<StepContext> => {
	const { topicId, chapterIndex, runId, singleChapterMode } = payload;
	const chapters = await getChaptersByTopicId(topicId);
	if (!chapters.length) throw new Error('Chapters not found');
	const chapterDoc = chapters[chapterIndex];
	if (!chapterDoc) throw new Error(`Chapter not found: ${chapterIndex}`);
	const { personas, topicTitle } = await getTopicContext(topicId);
	const existingTurns = await getDebateTurnsByTopicId(topicId);
	const persistedQueuedIntents = await loadQueuedIntents(topicId, chapterDoc.id);
	const state = getDebateState(existingTurns, personas, persistedQueuedIntents);
	state.runId = runId;
	const progress = await loadChapterProgress(topicId, chapterDoc.id, chapterDoc);
	state.discussionPoints = progress.discussionPointStatuses;
	return {
		chapters,
		chapterDoc,
		chapter: chapterDoc,
		personas,
		topicTitle,
		state,
		chapterTurnStartInState: existingTurns.length - chapterDoc.turns.length,
		chapterEndCount: progress.chapterEndCount,
		isLastChapter: !!singleChapterMode || chapterIndex >= chapters.length - 1
	};
};

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
	chapterEndCount: number
): Promise<void> => {
	if (ctx.chapterDoc.status === 'completed') return;
	const next = decideNextStep({
		chapterTurns: ctx.state.turns.slice(ctx.chapterTurnStartInState),
		globalTurnCount: ctx.state.turns.length,
		chapterEndCount,
		discussionPoints: ctx.state.discussionPoints,
		chapterIndex: payload.chapterIndex,
		options: stepOptions(payload),
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
	await enqueueAfterTurn(ctx, payload, ctx.chapterEndCount);
};

/**
 * 新経路の1ターン生成（while ループの executeTurn と等価）。
 * chapterEndCount を継続シグナルから決め、追記と同一トランザクションで書き込む。
 * freeze=true（章末 +1 最終応答）のときは chapterEndCount を据え置き、簡略フローで生成する。
 */
const generateSingleTurn = async ({
	topicId,
	personas,
	chapter,
	chapterId,
	state,
	chapterTurnStartInState,
	interventionCooldown,
	chapterEndCount,
	freeze
}: {
	topicId: string;
	personas: Persona[];
	chapter: Chapter;
	chapterId: string;
	state: DebateState;
	chapterTurnStartInState: number;
	interventionCooldown: number;
	chapterEndCount: number;
	freeze: boolean;
}): Promise<{ committed: boolean; chapterEndCount: number }> => {
	const getChapterTurns = (): DebateTurn[] => state.turns.slice(chapterTurnStartInState);
	const targetPersona = getLastTargetPersona(state.turns);

	// 章末 +1 最終応答: 旧ループの章末ブロックと等価（expire/addQueue を行わず固定の指名先に応答させる）
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
			progressPatch: { chapterEndCount }
		});
		if (!reply) return { committed: false, chapterEndCount };
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
		return { committed: true, chapterEndCount };
	}

	await expireQueuedIntents({ topicId, chapterId, state });
	const engagements = await evaluateEngagements({
		topicId,
		chapterId,
		personas,
		state,
		chapterTurns: getChapterTurns()
	});

	// ファシリテーター介入（target がない場合のみ）。介入は継続扱いで chapterEndCount を 0 にする
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
			progressPatch: { chapterEndCount: 0 }
		});
		if (intervened) {
			await saveDiscussionPointStatuses(topicId, chapterId, state);
			return { committed: true, chapterEndCount: 0 };
		}
	}

	const speakerSelection = selectSpeaker({ targetPersona, engagements, state, personas });
	await addQueuedIntents({
		topicId,
		chapterId,
		state,
		engagements,
		speakerSelection,
		triggerTurnId: state.turns[state.turns.length - 1]?.id ?? ''
	});
	const engagement = await evaluateEngagementWithFallback({
		personaId: speakerSelection.personaId,
		personas,
		chapterTurns: getChapterTurns(),
		engagements
	});
	const shouldContinue =
		engagements.length === 0 || engagements.some((a) => a.score >= CONTINUE_CHAPTER_THRESHOLD);
	const nextEndCount = shouldContinue ? 0 : chapterEndCount + 1;

	const reply = await generatePersonaTurn({
		topicId,
		personas,
		chapter,
		state,
		speakerSelection,
		engagement,
		chapterTurnStartIndex: chapterTurnStartInState,
		progressPatch: { chapterEndCount: nextEndCount }
	});
	if (!reply) return { committed: false, chapterEndCount };
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
	return { committed: true, chapterEndCount: nextEndCount };
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

	await updateChapterStatus(topicId, chapterDoc.id, 'running');
	state.discussionPoints = (chapter.discussionPoints ?? []).map((point) => ({
		point,
		status: 'untouched' as const
	}));
	await saveDiscussionPointStatuses(topicId, chapterDoc.id, state);

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
	const { chapterDoc, chapter, personas, state, chapterTurnStartInState, chapterEndCount } = ctx;
	const { topicId } = payload;
	const options = stepOptions(payload);
	const chapterLocalCount = chapterDoc.turns.length;
	const freeze = !!payload.finalResponse; // 章末 +1 最終応答は chapterEndCount を据え置く

	if (chapterDoc.status === 'completed') return false;

	// frontier 不一致（並走の敗者・既に前進済み）→ 生成しない。
	// 最終応答ステップなら +1 は済んでいるので summary/closing へ直行、通常ステップは resume
	if (chapterLocalCount !== payload.expectedTurnIndex) {
		if (freeze) await enqueueChapterEnd(ctx, payload);
		else await enqueueAfterTurn(ctx, payload, chapterEndCount);
		return false;
	}

	const result = await generateSingleTurn({
		topicId,
		personas,
		chapter,
		chapterId: chapterDoc.id,
		state,
		chapterTurnStartInState,
		interventionCooldown: options.interventionCooldown,
		chapterEndCount,
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

	let finalEndCount = result.chapterEndCount;
	// 早期終了カバレッジ評価。未消化が残ればカウンタを 0 に戻して継続させる
	const chapterTurnCountNow = state.turns.length - chapterTurnStartInState;
	if (
		chapterTurnCountNow >= Math.ceil(options.turnsPerChapter * EARLY_END_PROGRESS_RATIO) &&
		finalEndCount >= CHAPTER_END_COUNT_LIMIT
	) {
		const incomplete = state.discussionPoints.filter((p) => p.status !== 'addressed');
		if (incomplete.length > 0) {
			const coverageResult = await evaluateDiscussionPointCoverage(
				state.turns.slice(chapterTurnStartInState),
				incomplete.map((p) => p.point),
				personas
			);
			if (coverageResult.ok) {
				for (const idx of coverageResult.value) {
					const target = state.discussionPoints.find((p) => p.point === incomplete[idx]?.point);
					if (target) target.status = 'addressed';
				}
				await saveDiscussionPointStatuses(topicId, chapterDoc.id, state);
				if (state.discussionPoints.some((p) => p.status !== 'addressed')) {
					finalEndCount = 0;
					await db()
						.doc(`topics/${topicId}/chapters/${chapterDoc.id}`)
						.update({ chapterEndCount: 0 });
				}
			}
		}
	}

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
