import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { getChaptersByTopicId } from './debate-state.js';
import type { ChapterEntry } from '../../types/debate.types.js';

const db = () => getFirestore();

/** 章のステータス（running / completed など）を更新する */
export const updateChapterStatus = async (
	topicId: string,
	chapterId: string,
	status: ChapterEntry['status']
): Promise<void> => {
	await db().doc(`topics/${topicId}/chapters/${chapterId}`).update({ status });
};

export const activateDebate = async (topicId: string): Promise<string> => {
	const runId = nanoid();
	await db()
		.doc(`topics/${topicId}`)
		.update({ phase: 5, phaseStatus: 'running', runId, updatedAt: Timestamp.now() });
	return runId;
};

export const markDebateStopped = async (topicId: string): Promise<void> => {
	await db()
		.doc(`topics/${topicId}`)
		.update({ phaseStatus: 'stopped', updatedAt: Timestamp.now() });
};

/** 指定章以降を破棄対象として turns/進捗/status をリセットし、破棄した章を返す */
const discardChaptersFrom = async (topicId: string, chapterId: string): Promise<ChapterEntry[]> => {
	const chapters = await getChaptersByTopicId(topicId);
	const targetIdx = chapters.findIndex((c) => c.id === chapterId);
	const discardChapters = chapters.slice(targetIdx >= 0 ? targetIdx : 0);
	for (const chapter of discardChapters) {
		await db().doc(`topics/${topicId}/chapters/${chapter.id}`).update({
			turns: [],
			discussionPointStatuses: FieldValue.delete(),
			quietStreak: FieldValue.delete(),
			status: 'pending'
		});
	}
	return discardChapters;
};

/** 破棄したターンに紐づく belief を各ペルソナからまとめて巻き戻す（restart 固有のバルク操作） */
const rollbackBeliefsForRemovedTurns = async (
	topicId: string,
	removedTurnIds: Set<string>
): Promise<void> => {
	const personasSnap = await db().collection(`topics/${topicId}/personas`).get();
	for (const personaSnap of personasSnap.docs) {
		const pdata = personaSnap.data() as { beliefs?: Array<{ triggeredByTurnId?: string | null }> };
		const beliefs = pdata.beliefs ?? [];
		const filtered = beliefs.filter(
			(b) => !(b.triggeredByTurnId && removedTurnIds.has(b.triggeredByTurnId))
		);
		if (filtered.length !== beliefs.length) {
			await personaSnap.ref.update({ beliefs: filtered });
		}
	}
};

/** 破棄した各章の engagements サブコレクションを削除する */
const deleteChapterEngagements = async (
	topicId: string,
	chapters: ChapterEntry[]
): Promise<void> => {
	for (const chapter of chapters) {
		const engSnap = await db()
			.collection(`topics/${topicId}/chapters/${chapter.id}/engagements`)
			.get();
		for (const engDoc of engSnap.docs) {
			await engDoc.ref.delete();
		}
	}
};

export const restartChapter = async (topicId: string, chapterId: string): Promise<string> => {
	const discardChapters = await discardChaptersFrom(topicId, chapterId);
	const removedTurnIds = new Set(discardChapters.flatMap((c) => c.turns).map((t) => t.id));

	await db().doc(`topics/${topicId}/postDebateComments/0`).set({ comments: [] });

	await rollbackBeliefsForRemovedTurns(topicId, removedTurnIds);
	await deleteChapterEngagements(topicId, discardChapters);

	return await activateDebate(topicId);
};
