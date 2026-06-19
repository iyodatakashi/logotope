import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import type { DebateSession } from '../../types/debate.types.js';

const db = () => getFirestore();

export const getDebateSessionByTopicId = async (topicId: string): Promise<DebateSession | null> => {
	const snap = await db().doc(`topics/${topicId}/sessions/0`).get();
	if (!snap.exists) return null;
	const data = snap.data() as {
		totalTurns?: number;
		createdAt: Timestamp;
		completedAt?: Timestamp;
		publishedAt?: Timestamp;
		chapters?: Array<{ id: string; title: string; focusQuestion: string; discussionPoints?: string[] }>;
		currentChapterIndex?: number;
	};
	return {
		id: topicId,
		topicId,
		totalTurns: data.totalTurns ?? null,
		createdAt: data.createdAt?.toDate().toISOString() ?? '',
		completedAt: data.completedAt?.toDate().toISOString() ?? null,
		publishedAt: data.publishedAt?.toDate().toISOString() ?? null,
		chapters: data.chapters?.map((c) => ({ ...c, discussionPoints: c.discussionPoints ?? [] })),
		currentChapterIndex: data.currentChapterIndex,
	};
};

export const activateDebate = async (topicId: string): Promise<void> => {
	await db().doc(`topics/${topicId}`).update({ phase: 5, phaseStatus: 'running', updatedAt: Timestamp.now() });
};

export const markDebateStopped = async (topicId: string): Promise<void> => {
	await db().doc(`topics/${topicId}`).update({ phaseStatus: 'stopped', updatedAt: Timestamp.now() });
};

export const restartChapter = async (topicId: string, chapterId: string): Promise<void> => {
	const sessionRef = db().doc(`topics/${topicId}/sessions/0`);
	const snap = await sessionRef.get();
	if (!snap.exists) return;
	const data = snap.data() as {
		turns?: Array<{ id: string; turnIndex: number; chapterId?: string }>;
		chapters?: Array<{ id: string }>;
	};
	const turns = data.turns ?? [];
	const chapters = data.chapters ?? [];

	const targetIdx = chapters.findIndex((c) => c.id === chapterId);
	const discardChapterIds = new Set(
		chapters.slice(targetIdx >= 0 ? targetIdx : 0).map((c) => c.id)
	);
	const removed = turns.filter((t) => t.chapterId && discardChapterIds.has(t.chapterId));
	const kept = turns.filter((t) => !t.chapterId || !discardChapterIds.has(t.chapterId));
	const removedTurnIds = new Set(removed.map((t) => t.id));
	const removedTurnIndexes = removed.map((t) => t.turnIndex);

	await sessionRef.update({
		turns: kept,
		currentChapterIndex: targetIdx >= 0 ? targetIdx : 0,
		postDebateComments: [],
		totalTurns: FieldValue.delete(),
		completedAt: FieldValue.delete(),
	});

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
		const engSnap = await db().collection(`topics/${topicId}/sessions/0/engagements`).get();
		const updates: Record<string, unknown> = {};
		for (const ti of removedTurnIndexes) {
			updates[`history.${ti}`] = FieldValue.delete();
		}
		for (const engDoc of engSnap.docs) {
			await engDoc.ref.update(updates);
		}
	}

	await activateDebate(topicId);
};
