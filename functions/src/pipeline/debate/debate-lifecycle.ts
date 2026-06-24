import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { discardChaptersFrom } from './chapter.js';
import { rollbackBeliefsForRemovedTurns } from './belief.js';
import { deleteChapterEngagements } from './engagement.js';

const db = () => getFirestore();

/**
 * 討論の phaseStatus を切り替え、新しい世代 runId を発行して返す。
 * running: 開始/再開。stopped: 試行尽きで停止（新 runId により古いタスクの追記は世代不一致で弾かれる）。
 */
export const updateDebatePhaseStatus = async (
	topicId: string,
	status: 'running' | 'stopped'
): Promise<string> => {
	const runId = nanoid();
	await db()
		.doc(`topics/${topicId}`)
		.update({ phase: 5, phaseStatus: status, runId, updatedAt: Timestamp.now() });
	return runId;
};

/** 討論が稼働中（phase 5 かつ phaseStatus running）かを判定する */
export const isDebateActive = async (topicId: string): Promise<boolean> => {
	const snap = await db().doc(`topics/${topicId}`).get();
	if (!snap.exists) return false;
	const data = snap.data() as { phase?: number; phaseStatus?: string };
	return data.phase === 5 && data.phaseStatus === 'running';
};

export const restartChapter = async (topicId: string, chapterId: string): Promise<string> => {
	const discardChapters = await discardChaptersFrom(topicId, chapterId);
	const removedTurnIds = new Set(discardChapters.flatMap((c) => c.turns).map((t) => t.id));

	await db().doc(`topics/${topicId}/postDebateComments/0`).set({ comments: [] });

	await rollbackBeliefsForRemovedTurns(topicId, removedTurnIds);
	await deleteChapterEngagements(topicId, discardChapters);

	return await updateDebatePhaseStatus(topicId, 'running');
};
