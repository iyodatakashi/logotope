import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { generateTurn } from '../../agents/persona-agent.js';
import { generateChapterSummary, generateClosing } from '../../agents/facilitator-agent.js';
import { verifyAndReviseDraft } from './inline-fact-check.js';
import { getLatestBelief } from './belief.js';
import { isDebateActive } from './debate-lifecycle.js';
import { pipelineErrorMessage, validPersonaId } from './utils.js';
import { currentDateString } from '../../utils/prompt-formatters.js';
import type {
	DebateState,
	SpeakerSelection,
	QueuedIntent,
	BeliefChangeEvent,
	Engagement
} from '../../types/debate.types.js';
import type {
	DebateTurn,
	AppendTurnInput,
	AppendResult,
	NewTurnFields,
	ProgressPatch,
	TurnGenerationContext
} from '../../types/turn.types.js';
import type { FactCheckContext } from '../../types/fact-check.types.js';
import type { Chapter } from '../../types/chapter.types.js';
import type { Persona } from '../../types/persona.types.js';

const db = () => getFirestore();

/** NewTurnFields から永続化用のターンレコード（undefined フィールドを除外）を構築する */
const buildTurnRecord = (id: string, turn: NewTurnFields): Record<string, unknown> => {
	const record: Record<string, unknown> = {
		id,
		speakerType: turn.speakerType,
		content: turn.content,
		createdAt: Timestamp.now()
	};
	if (turn.personaId !== undefined) record.personaId = turn.personaId;
	if (turn.speechMode !== undefined) record.speechMode = turn.speechMode;
	if (turn.engagementScore !== undefined) record.engagementScore = turn.engagementScore;
	if (turn.fromQueue) record.fromQueue = true;
	if (turn.targetPersonaId !== undefined) record.targetPersonaId = turn.targetPersonaId;
	if (turn.targetedBy !== undefined) record.targetedBy = turn.targetedBy;
	if (turn.searchUsed) record.searchUsed = true;
	if (turn.searchQueries?.length) record.searchQueries = turn.searchQueries;
	// 補正トレース（検証状態・補正有無・適用指摘・補正前ドラフト）を発言に co-located で永続化（4.2）
	if (turn.factCheck !== undefined) record.factCheck = turn.factCheck;
	return record;
};

/**
 * 章ローカル `turns.length === expectedTurnIndex` のときだけ1ターン追記し、runId 世代照合と
 * 進捗（quietStreak / discussionPointStatuses）更新を同一トランザクションで行う冪等追記。
 * 不一致時は例外を投げず rejected を返して副作用を残さない。
 */
export const addTurn = async (input: AppendTurnInput): Promise<AppendResult> => {
	const { topicId, chapterId, expectedTurnIndex, turn, runId, progressPatch } = input;
	const chapterRef = db().doc(`topics/${topicId}/chapters/${chapterId}`);
	const topicRef = db().doc(`topics/${topicId}`);
	const id = nanoid();
	return db().runTransaction(async (tx) => {
		// runId がペイロード・topic doc の双方にある場合のみ世代照合する（後方互換）
		if (runId) {
			const topicSnap = await tx.get(topicRef);
			const topicData = topicSnap.data() as { runId?: string } | undefined;
			if (topicData?.runId && topicData.runId !== runId) {
				return { status: 'rejected', reason: 'generation_mismatch' };
			}
		}
		const chapterSnap = await tx.get(chapterRef);
		const data = chapterSnap.data() as { turns?: DebateTurn[] } | undefined;
		const currentTurns = data?.turns ?? [];
		if (currentTurns.length !== expectedTurnIndex) {
			return { status: 'rejected', reason: 'index_mismatch' };
		}
		const update: Record<string, unknown> = {
			turns: [...currentTurns, buildTurnRecord(id, turn)]
		};
		if (progressPatch?.quietStreak !== undefined) {
			update.quietStreak = progressPatch.quietStreak;
		}
		if (progressPatch?.discussionPointStatuses !== undefined) {
			update.discussionPointStatuses = progressPatch.discussionPointStatuses;
		}
		tx.update(chapterRef, update);
		return { status: 'committed', id };
	});
};

/**
 * ファシリテーター発言を期待位置照合のうえ保存し、committed なら state.turns を更新する。
 * 期待位置は章ローカル長 `state.turns.length - chapterTurnStartIndex`。追記結果をそのまま返す。
 */
export const generateFacilitatorTurn = async ({
	topicId,
	state,
	content,
	targetPersonaId,
	chapterId,
	chapterTurnStartIndex = 0,
	progressPatch
}: {
	topicId: string;
	state: DebateState;
	content: string;
	targetPersonaId?: string;
	chapterId: string;
	chapterTurnStartIndex?: number;
	progressPatch?: ProgressPatch;
}): Promise<AppendResult> => {
	const result = await addTurn({
		topicId,
		chapterId,
		expectedTurnIndex: state.turns.length - chapterTurnStartIndex,
		turn: {
			speakerType: 'facilitator',
			content,
			targetPersonaId,
			targetedBy: targetPersonaId ? 'facilitator' : undefined
		},
		runId: state.runId,
		progressPatch
	});
	if (result.status !== 'committed') return result;
	state.turns.push({
		id: result.id,
		speakerType: 'facilitator',
		content,
		createdAt: Timestamp.now(),
		targetPersonaId,
		targetedBy: targetPersonaId ? 'facilitator' : undefined
	});
	state.lastSpeakerId = undefined;
	return result;
};

/**
 * キュー由来の発言意図から、トリガーとなったターンの話者名・内容を整形する。
 * 対象キューが空、またはトリガーターンが見つからない場合は undefined を返す。
 */
const buildQueuedTrigger = (
	queuedEntries: QueuedIntent[] | undefined,
	turns: DebateTurn[],
	personas: Persona[]
): { speakerName: string; content: string } | undefined => {
	if (!queuedEntries || queuedEntries.length === 0) return undefined;
	const triggerTurn = turns.find((t) => t.id === queuedEntries[0].triggerTurnId);
	if (!triggerTurn) return undefined;
	const triggerPersona = triggerTurn.personaId
		? personas.find((p) => p.id === triggerTurn.personaId)
		: undefined;
	return {
		speakerName: triggerPersona ? triggerPersona.name : 'ファシリテーター',
		content: triggerTurn.content
	};
};

/** 決定に基づきペルソナ発言を生成・保存する。討論停止時は null を返す */
export const generatePersonaTurn = async ({
	topicId,
	topicTitle = '',
	personas,
	chapter,
	state,
	speakerSelection,
	engagement,
	chapterTurnStartIndex = 0,
	progressPatch
}: {
	topicId: string;
	topicTitle?: string;
	personas: Persona[];
	chapter: Chapter;
	state: DebateState;
	speakerSelection: SpeakerSelection;
	engagement: Engagement;
	chapterTurnStartIndex?: number;
	progressPatch?: ProgressPatch;
}): Promise<{
	turnId: string;
	personaId: string;
	targetPersonaId: string | undefined;
	beliefChange: BeliefChangeEvent | null;
	queuedEntries: QueuedIntent[] | undefined;
	fromQueue: boolean;
} | null> => {
	const persona = personas.find((p) => p.id === speakerSelection.personaId)!;
	const fromQueue = speakerSelection.reason === 'queue';

	const chapterTurns = state.turns.slice(chapterTurnStartIndex);
	const queuedEntries = state.queuedIntents.get(persona.id);
	const queuedTrigger = buildQueuedTrigger(queuedEntries, state.turns, personas);

	const otherPersonas = personas
		.filter((p) => p.id !== persona.id)
		.map((p) => ({ id: p.id, name: p.name }));

	// 補正モジュールが再生成時に再利用できるよう、生成文脈とエンゲージメントを一度組み立てる
	const generationContext: TurnGenerationContext = {
		chapterTurns,
		chapter,
		queuedTrigger,
		targetedBy:
			speakerSelection.reason === 'targeted_by_facilitator' ||
			speakerSelection.reason === 'targeted_by_persona'
				? speakerSelection.reason === 'targeted_by_facilitator'
					? 'facilitator'
					: 'persona'
				: undefined,
		otherPersonas
	};
	const turnEngagement: Engagement = {
		...engagement,
		intentSummary: speakerSelection.intentSummary ?? engagement.intentSummary
	};

	// まずドラフトを生成する
	const turnResult = await generateTurn(persona, generationContext, turnEngagement, personas);
	if (!turnResult.ok) throw new Error(pipelineErrorMessage(turnResult.error));

	// 生成中に討論が停止された場合は、ドラフトを検証・保存せず状態も更新しない
	if (!(await isDebateActive(topicId))) return null;

	// 討論継続中はインライン検証・補正を経てから正式登録する（誤った発言の伝播を防ぐ）
	const factCheckContext: FactCheckContext = {
		topicTitle,
		chapterTitle: chapter.title,
		focusQuestion: chapter.focusQuestion,
		currentDate: currentDateString()
	};
	const { reply, trace } = await verifyAndReviseDraft({
		draft: turnResult.value,
		persona,
		context: generationContext,
		factCheckContext,
		engagement: turnEngagement,
		personas
	});

	// 採用された発言（補正後 or 原ドラフト）で指名先の再検証・発言モード確定を行う（3.3）
	const rawTarget = reply.targetPersonaId;
	const targetPersonaId =
		rawTarget !== persona.id ? validPersonaId(rawTarget, personas) : undefined;

	// question モードで targetPersonaId が設定されなかった場合は opinion にフォールバック
	const effectiveSpeechMode =
		reply.speechMode === 'question' && !targetPersonaId ? 'opinion' : reply.speechMode;

	const addTurnResult = await addTurn({
		topicId,
		chapterId: chapter.id,
		expectedTurnIndex: state.turns.length - chapterTurnStartIndex,
		turn: {
			speakerType: 'persona',
			personaId: persona.id,
			content: reply.content,
			speechMode: effectiveSpeechMode,
			engagementScore: engagement.score,
			fromQueue: fromQueue || undefined,
			targetPersonaId,
			targetedBy: targetPersonaId ? 'persona' : undefined,
			searchUsed: reply.searchUsed,
			searchQueries: reply.searchQueries,
			factCheck: trace
		},
		runId: state.runId,
		progressPatch
	});
	if (addTurnResult.status !== 'committed') return null;
	const { id: turnId } = addTurnResult;
	state.turns.push({
		id: turnId,
		speakerType: 'persona',
		personaId: persona.id,
		content: reply.content,
		createdAt: Timestamp.now(),
		fromQueue: fromQueue || undefined,
		targetPersonaId,
		targetedBy: targetPersonaId ? 'persona' : undefined,
		factCheck: trace
	});

	return {
		turnId,
		personaId: persona.id,
		targetPersonaId,
		beliefChange: reply.beliefChange,
		queuedEntries,
		fromQueue
	};
};

/** 章まとめ: 現章の議論をまとめるファシリテーターターンを生成する */
export const generateChapterTransition = async ({
	topicId,
	chapter,
	state,
	personas,
	chapterTurnStartIndex = 0
}: {
	topicId: string;
	chapter: Chapter;
	state: DebateState;
	personas: Persona[];
	chapterTurnStartIndex?: number;
}): Promise<void> => {
	const summaryResult = await generateChapterSummary(state.turns.slice(-10), chapter, personas);
	if (summaryResult.ok) {
		await generateFacilitatorTurn({
			topicId,
			state,
			chapterId: chapter.id,
			content: summaryResult.value,
			chapterTurnStartIndex
		});
	}
};

/** クロージングのファシリテーターターンを期待位置照合のうえ追記する。追記結果を返す */
export const appendClosingTurn = async ({
	topicId,
	personas,
	state,
	chapterId,
	chapterTurnStartIndex = 0
}: {
	topicId: string;
	personas: Persona[];
	state: DebateState;
	chapterId: string;
	chapterTurnStartIndex?: number;
}): Promise<AppendResult> => {
	const finalBeliefs = new Map(personas.map((p) => [p.id, getLatestBelief(p).content]));
	const closingResult = await generateClosing(state.turns, finalBeliefs, personas);
	if (!closingResult.ok) throw new Error(pipelineErrorMessage(closingResult.error));
	return generateFacilitatorTurn({
		topicId,
		state,
		chapterId,
		content: closingResult.value ?? '',
		chapterTurnStartIndex
	});
};
