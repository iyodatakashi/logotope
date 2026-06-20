import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import type { DebateTurn } from '../../types/debate.types.js';

const db = () => getFirestore();

export type ChapterEntry = {
	id: string;
	chapterIndex: number;
	title: string;
	focusQuestion: string;
	discussionPoints: string[];
	turns: DebateTurn[];
	status: 'pending' | 'running' | 'completed';
};

export const getChaptersByTopicId = async (topicId: string): Promise<ChapterEntry[]> => {
	const snap = await db()
		.collection(`topics/${topicId}/chapters`)
		.orderBy('chapterIndex')
		.get();
	return snap.docs.map((docSnap) => {
		const data = docSnap.data() as {
			chapterIndex: number;
			title: string;
			focusQuestion: string;
			discussionPoints?: string[];
			turns?: Array<{
				id: string;
				turnIndex: number;
				speakerType: string;
				personaId?: string;
				content: string;
				createdAt: Timestamp;
				fromQueue?: boolean;
				targetPersonaId?: string;
			}>;
			status?: 'pending' | 'running' | 'completed';
		};
		return {
			id: docSnap.id,
			chapterIndex: data.chapterIndex,
			title: data.title,
			focusQuestion: data.focusQuestion,
			discussionPoints: data.discussionPoints ?? [],
			turns: (data.turns ?? []).map((t) => ({
				id: t.id,
				turnIndex: t.turnIndex,
				speakerType: t.speakerType,
				personaId: t.personaId ?? null,
				content: t.content,
				createdAt: t.createdAt?.toDate?.().toISOString() ?? '',
				fromQueue: t.fromQueue,
				targetPersonaId: t.targetPersonaId
			})),
			status: data.status ?? 'pending',
		};
	});
};

export const activateDebate = async (topicId: string): Promise<void> => {
	await db().doc(`topics/${topicId}`).update({ phase: 5, phaseStatus: 'running', updatedAt: Timestamp.now() });
};

export const markDebateStopped = async (topicId: string): Promise<void> => {
	await db().doc(`topics/${topicId}`).update({ phaseStatus: 'stopped', updatedAt: Timestamp.now() });
};

export const restartChapter = async (topicId: string, chapterId: string): Promise<void> => {
	const chapters = await getChaptersByTopicId(topicId);
	const targetIdx = chapters.findIndex((c) => c.id === chapterId);
	const discardChapters = chapters.slice(targetIdx >= 0 ? targetIdx : 0);
	const discardedTurns = discardChapters.flatMap((c) => c.turns);
	const removedTurnIds = new Set(discardedTurns.map((t) => t.id));
	const removedTurnIndexes = discardedTurns.map((t) => t.turnIndex);

	for (const chapter of discardChapters) {
		await db().doc(`topics/${topicId}/chapters/${chapter.id}`).update({
			turns: [],
			discussionPointStatuses: FieldValue.delete(),
			status: 'pending',
		});
	}

	await db().doc(`topics/${topicId}/postDebateComments/0`).set({ comments: [] });

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

	if (removedTurnIndexes.length > 0) {
		const engSnap = await db().collection(`topics/${topicId}/engagements`).get();
		if (engSnap.size > 0) {
			const updates: Record<string, unknown> = { queuedIntents: FieldValue.delete() };
			for (const ti of removedTurnIndexes) {
				updates[`history.${ti}`] = FieldValue.delete();
			}
			for (const engDoc of engSnap.docs) {
				await engDoc.ref.update(updates);
			}
		}
	}

	await activateDebate(topicId);
};
