import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import {
	generateTurn,
	generatePostDebateComment
} from '../../agents/persona-agent.js';
import {
	generateChapterSummary,
	generateClosing
} from '../../agents/facilitator-agent.js';
import { pipelineErrorMessage, validPersonaId } from './utils.js';
import type { DebateState, SpeakerSelection, QueuedIntent, BeliefChangeEvent, Engagement, DebateTurn } from '../../types/debate.types.js';
import type { Chapter } from '../../types/chapter.types.js';
import type { Persona } from '../../types/persona.types.js';

const db = () => getFirestore();

const personaDocRef = (topicId: string, personaId: string) =>
	db().doc(`topics/${topicId}/personas/${personaId}`);

const getLatestBelief = (persona: Persona): { content: string; version: number } => {
	const beliefs = persona.beliefs ?? [];
	if (beliefs.length === 0) return { content: '', version: 0 };
	return beliefs.reduce((best, b) => (b.version > best.version ? b : best));
};

export const isDebateActive = async (topicId: string): Promise<boolean> => {
	const snap = await db().doc(`topics/${topicId}`).get();
	if (!snap.exists) return false;
	const data = snap.data() as { phase?: number; phaseStatus?: string };
	return data.phase === 5 && data.phaseStatus === 'running';
};

export const addTurn = async (params: {
	topicId: string;
	turnIndex: number;
	speakerType: 'persona' | 'facilitator';
	personaId?: string;
	speakerName?: string;
	speakerRole?: string;
	content: string;
	chapterId?: string;
	speechMode?: 'opinion' | 'fact' | 'question';
	engagementScore?: number;
	fromQueue?: boolean;
	targetPersonaId?: string;
	targetedBy?: 'facilitator' | 'persona';
	searchUsed?: boolean;
	searchQueries?: string[];
}): Promise<{ id: string }> => {
	const id = nanoid();
	const turn: Record<string, unknown> = {
		id,
		turnIndex: params.turnIndex,
		speakerType: params.speakerType,
		content: params.content,
		createdAt: Timestamp.now()
	};
	if (params.personaId !== undefined) turn.personaId = params.personaId;
	if (params.speakerName !== undefined) turn.speakerName = params.speakerName;
	if (params.speakerRole !== undefined) turn.speakerRole = params.speakerRole;
	if (params.speechMode !== undefined) turn.speechMode = params.speechMode;
	if (params.engagementScore !== undefined) turn.engagementScore = params.engagementScore;
	if (params.fromQueue) turn.fromQueue = true;
	if (params.chapterId !== undefined) turn.chapterId = params.chapterId;
	if (params.targetPersonaId !== undefined) turn.targetPersonaId = params.targetPersonaId;
	if (params.targetedBy !== undefined) turn.targetedBy = params.targetedBy;
	if (params.searchUsed) turn.searchUsed = true;
	if (params.searchQueries?.length) turn.searchQueries = params.searchQueries;
	await db()
		.doc(`topics/${params.topicId}/sessions/0`)
		.update({ turns: FieldValue.arrayUnion(turn) });
	return { id };
};

export const updateSpeakerStats = ({
	state,
	personas,
	personaId
}: {
	state: DebateState;
	personas: Persona[];
	personaId: string;
}): void => {
	for (const p of personas) {
		state.silenceMap.set(p.id, p.id === personaId ? 0 : (state.silenceMap.get(p.id) ?? 0) + 1);
	}
	state.speakCount.set(personaId, (state.speakCount.get(personaId) ?? 0) + 1);
	state.lastSpeakerId = personaId;
};

export const applyBeliefChange = async ({
	topicId,
	persona,
	turnId,
	beliefChange
}: {
	topicId: string;
	persona: Persona;
	turnId: string;
	beliefChange: BeliefChangeEvent;
}): Promise<void> => {
	const belief = getLatestBelief(persona);
	const newVersion = belief.version + 1;
	const id = nanoid();
	const beliefEntry: Record<string, unknown> = {
		id,
		version: newVersion,
		content: beliefChange.updatedBelief,
		createdAt: Timestamp.now()
	};
	if (beliefChange.type !== undefined) beliefEntry.changeType = beliefChange.type;
	if (beliefChange.summary !== undefined) beliefEntry.changeSummary = beliefChange.summary;
	if (turnId !== undefined) beliefEntry.triggeredByTurnId = turnId;
	await personaDocRef(topicId, persona.id).update({
		beliefs: FieldValue.arrayUnion(beliefEntry)
	});
	persona.beliefs = [
		...(persona.beliefs ?? []),
		{
			id,
			version: newVersion,
			content: beliefChange.updatedBelief,
			changeType: beliefChange.type,
			changeSummary: beliefChange.summary,
			triggeredByTurnId: turnId,
			createdAt: new Date().toISOString()
		}
	];
};

/** ファシリテーター発言を保存し、state.turns を更新して発言内容を返す */
export const generateFacilitatorTurn = async ({
	topicId,
	state,
	content,
	targetPersonaId,
	chapterId
}: {
	topicId: string;
	state: DebateState;
	content: string;
	targetPersonaId?: string;
	chapterId?: string;
}): Promise<{ content: string; targetPersonaId?: string }> => {
	const turnIndex = state.turns.length;
	const { id: turnId } = await addTurn({
		topicId,
		turnIndex,
		speakerType: 'facilitator',
		speakerName: 'ファシリテーター',
		speakerRole: '',
		content,
		chapterId,
		targetPersonaId,
		targetedBy: targetPersonaId ? 'facilitator' : undefined
	});
	state.turns.push({
		id: turnId,
		turnIndex,
		speakerType: 'facilitator',
		speakerName: 'ファシリテーター',
		speakerRole: '',
		content,
		createdAt: new Date().toISOString(),
		chapterId,
		targetPersonaId,
		targetedBy: targetPersonaId ? 'facilitator' : undefined
	});
	state.pairConversationTurns = 0;
	state.lastSpeakerId = undefined;
	return { content, targetPersonaId };
};

/** 決定に基づきペルソナ発言を生成・保存する。討論停止時は null を返す */
export const generatePersonaTurn = async ({
	topicId,
	personas,
	chapter,
	state,
	speakerSelection,
	engagement
}: {
	topicId: string;
	personas: Persona[];
	chapter: Chapter;
	state: DebateState;
	speakerSelection: SpeakerSelection;
	engagement: Engagement;
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

	const chapterTurns = state.turns.filter((t) => t.chapterId === chapter.id);
	const queuedEntries = state.queuedIntents.get(persona.id);
	let pendingTrigger: { speakerName: string; content: string } | undefined;
	if (queuedEntries && queuedEntries.length > 0) {
		const triggerTurn = state.turns.find((t) => t.turnIndex === queuedEntries[0].triggerTurnIndex);
		pendingTrigger = triggerTurn
			? { speakerName: triggerTurn.speakerName ?? '', content: triggerTurn.content }
			: undefined;
	}

	const otherPersonas = personas
		.filter((p) => p.id !== persona.id)
		.map((p) => ({ id: p.id, name: p.name }));

	const turnResult = await generateTurn(
		persona,
		{
			chapterTurns,
			chapter,
			pendingTrigger,
			targetedBy:
				speakerSelection.reason === 'targeted_by_facilitator' ||
				speakerSelection.reason === 'targeted_by_persona'
					? speakerSelection.reason === 'targeted_by_facilitator'
						? 'facilitator'
						: 'persona'
					: undefined,
			otherPersonas
		},
		{ ...engagement, intentSummary: speakerSelection.intentSummary ?? engagement.intentSummary }
	);
	if (!turnResult.ok) throw new Error(pipelineErrorMessage(turnResult.error));

	// 生成中に討論が停止された場合は、生成済みのセリフを保存せず状態も更新しない
	if (!(await isDebateActive(topicId))) return null;

	// 直接質問先は ID 検証のうえターンに永続化する（自分自身への指定は無視）
	const rawTarget = turnResult.value.targetPersonaId;
	const targetPersonaId =
		rawTarget !== persona.id ? validPersonaId(rawTarget, personas) : undefined;

	// question モードで targetPersonaId が設定されなかった場合は opinion にフォールバック
	const effectiveSpeechMode =
		turnResult.value.speechMode === 'question' && !targetPersonaId
			? 'opinion'
			: turnResult.value.speechMode;

	const turnIndex = state.turns.length;
	const { id: turnId } = await addTurn({
		topicId,
		turnIndex,
		speakerType: 'persona',
		personaId: persona.id,
		speakerName: persona.name,
		speakerRole: persona.specificRole,
		content: turnResult.value.content,
		chapterId: chapter.id,
		speechMode: effectiveSpeechMode,
		engagementScore: engagement.score,
		fromQueue: fromQueue || undefined,
		targetPersonaId,
		targetedBy: targetPersonaId ? 'persona' : undefined,
		searchUsed: turnResult.value.searchUsed,
		searchQueries: turnResult.value.searchQueries
	});
	state.turns.push({
		id: turnId,
		turnIndex,
		speakerType: 'persona',
		personaId: persona.id,
		speakerName: persona.name,
		speakerRole: persona.specificRole,
		content: turnResult.value.content,
		createdAt: new Date().toISOString(),
		chapterId: chapter.id,
		fromQueue: fromQueue || undefined,
		targetPersonaId,
		targetedBy: targetPersonaId ? 'persona' : undefined
	});

	return {
		turnId,
		personaId: persona.id,
		targetPersonaId,
		beliefChange: turnResult.value.beliefChange,
		queuedEntries,
		fromQueue
	};
};

/** 章まとめ: 現章の議論をまとめるファシリテーターターンを生成する */
export const generateChapterTransition = async ({
	topicId,
	chapter,
	state
}: {
	topicId: string;
	chapter: Chapter;
	state: DebateState;
}): Promise<void> => {
	const summaryResult = await generateChapterSummary(state.turns.slice(-10), chapter);
	if (summaryResult.ok) {
		await generateFacilitatorTurn({
			topicId,
			state,
			chapterId: chapter.id,
			content: summaryResult.value
		});
	}
};

/** 討論終端: クロージング → 事後コメント → セッション完了 */
export const finalizeDebate = async ({
	topicId,
	personas,
	state
}: {
	topicId: string;
	personas: Persona[];
	state: DebateState;
}): Promise<void> => {
	const finalBeliefs = new Map(personas.map((p) => [p.id, getLatestBelief(p).content]));
	const closingResult = await generateClosing(state.turns, finalBeliefs);
	if (!closingResult.ok) throw new Error(pipelineErrorMessage(closingResult.error));
	await generateFacilitatorTurn({ topicId, state, content: closingResult.value ?? '' });

	for (let i = 0; i < personas.length; i++) {
		const persona = personas[i];
		const finalBelief = getLatestBelief(persona).content;
		const commentResult = await generatePostDebateComment(persona, finalBelief, state.turns);
		if (commentResult.ok) {
			const id = nanoid();
			await db()
				.doc(`topics/${topicId}/sessions/0`)
				.update({
					postDebateComments: FieldValue.arrayUnion({
						id,
						personaId: persona.id,
						content: commentResult.value.content,
						sortOrder: i
					})
				});
		}
	}

	await db()
		.doc(`topics/${topicId}/sessions/0`)
		.update({ totalTurns: state.turns.length, completedAt: Timestamp.now() });

	const ref = db().doc(`topics/${topicId}`);
	await db().runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		if (!snap.exists) return;
		const data = snap.data() as { phaseStatus?: string };
		if (data.phaseStatus !== 'running') return;
		tx.update(ref, { phaseStatus: 'generated', updatedAt: Timestamp.now() });
	});
};

export const getDebateTurnsByTopicId = async (topicId: string): Promise<DebateTurn[]> => {
	const snap = await db().doc(`topics/${topicId}/sessions/0`).get();
	if (!snap.exists) return [];
	const data = snap.data() as {
		turns?: Array<{
			id: string;
			turnIndex: number;
			speakerType: string;
			personaId?: string;
			speakerName?: string;
			speakerRole?: string;
			content: string;
			createdAt: Timestamp;
			chapterId?: string;
			fromQueue?: boolean;
			targetPersonaId?: string;
		}>;
	};
	return (data.turns ?? []).map((t) => ({
		id: t.id,
		turnIndex: t.turnIndex,
		speakerType: t.speakerType,
		personaId: t.personaId ?? null,
		speakerName: t.speakerName,
		speakerRole: t.speakerRole,
		content: t.content,
		createdAt: t.createdAt?.toDate().toISOString() ?? '',
		chapterId: t.chapterId,
		fromQueue: t.fromQueue,
		targetPersonaId: t.targetPersonaId
	}));
};
