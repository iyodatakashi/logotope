import { getFirestore } from 'firebase-admin/firestore';
import type {
	DebateTurn,
	QueuedIntent,
	DebateState,
	DiscussionPointState,
	ChapterProgress
} from '../../types/debate.types.js';
import type { Persona } from '../../types/persona.types.js';
import type { Chapter } from '../../types/chapter.types.js';
import { INTENT_EXPIRY_TURNS } from '../../constants/debate.constants.js';

const db = () => getFirestore();

/** 保存済みターン・永続化キューから DebateState を導出する（同一入力 → 同一出力） */
export const getDebateState = (
	inputTurns: ReadonlyArray<DebateTurn>,
	personas: ReadonlyArray<Persona>,
	persistedQueuedIntents: ReadonlyMap<string, ReadonlyArray<QueuedIntent>>
): DebateState => {
	const turns = [...inputTurns];

	const speakCount = new Map<string, number>(personas.map((p) => [p.id, 0]));
	for (const t of turns) {
		if (t.personaId && t.speakerType === 'persona') {
			speakCount.set(t.personaId, (speakCount.get(t.personaId) ?? 0) + 1);
		}
	}

	const silenceMap = new Map<string, number>();
	for (const p of personas) {
		const lastSpokeIdx = turns.reduce(
			(max, t, i) => (t.personaId === p.id && t.speakerType === 'persona' ? i : max),
			-1
		);
		silenceMap.set(p.id, Math.max(0, turns.length - lastSpokeIdx - 1));
	}

	let lastSpeakerId: string | undefined;
	for (let i = turns.length - 1; i >= 0; i--) {
		if (turns[i].speakerType === 'persona' && turns[i].personaId) {
			lastSpeakerId = turns[i].personaId ?? undefined;
			break;
		}
	}

	const queuedIntents = new Map<string, QueuedIntent[]>();
	for (const [personaId, items] of persistedQueuedIntents.entries()) {
		const alive = items.filter((item) => {
			const triggerIdx = turns.findIndex((t) => t.id === item.triggerTurnId);
			if (triggerIdx === -1) return false;
			return turns.length - triggerIdx <= INTENT_EXPIRY_TURNS;
		});
		if (alive.length > 0) {
			queuedIntents.set(
				personaId,
				alive.map((item) => ({ ...item }))
			);
		}
	}

	return {
		turns,
		silenceMap,
		speakCount,
		lastSpeakerId,
		queuedIntents,
		discussionPoints: []
	};
};

/**
 * chapter doc から章進捗を復元する。chapterEndCount 未設定は 0、discussionPointStatuses 未設定は
 * 章の論点から untouched 初期化する。同一の永続データから同一の出力を返す（決定論）。
 */
export const loadChapterProgress = async (
	topicId: string,
	chapterId: string,
	chapter: Chapter
): Promise<ChapterProgress> => {
	const snap = await db().doc(`topics/${topicId}/chapters/${chapterId}`).get();
	const data = snap.data() as
		| { chapterEndCount?: number; discussionPointStatuses?: DiscussionPointState[] }
		| undefined;
	const discussionPointStatuses =
		data?.discussionPointStatuses ??
		(chapter.discussionPoints ?? []).map((point) => ({ point, status: 'untouched' as const }));
	return {
		chapterEndCount: data?.chapterEndCount ?? 0,
		discussionPointStatuses
	};
};
