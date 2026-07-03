import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { discardChaptersFrom, getChaptersByTopicId } from './chapter.js';
import { rollbackBeliefsForRemovedTurns } from './belief.js';
import { deleteChapterEngagements } from './engagement.js';
import { clearPostDebateComments } from './post-debate-comments.js';
import { deleteFactCheckResult } from '../fact-check/fact-check-repository.js';
import { clearEditedArtifact } from '../editing/edited-repository.js';
import type { PhaseKey } from '../../types/topic.types.js';

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
		.update({ phase: 'debate', phaseStatus: status, runId, updatedAt: Timestamp.now() });
	return runId;
};

/** 討論が稼働中（phase debate かつ phaseStatus running）かを判定する */
export const isDebateActive = async (topicId: string): Promise<boolean> => {
	const snap = await db().doc(`topics/${topicId}`).get();
	if (!snap.exists) return false;
	const data = snap.data() as { phase?: PhaseKey; phaseStatus?: string };
	return data.phase === 'debate' && data.phaseStatus === 'running';
};

/**
 * 指定章以降を破棄し、その章に紐づく付随データ（コメント・信念変化・engagements・ファクトチェック結果）を
 * まとめて削除する。reset（全章）と restart（指定章以降）で共通の削除責務をここに集約する。
 */
const discardChaptersWithSideData = async (
	topicId: string,
	fromChapterId: string
): Promise<void> => {
	const discardChapters = await discardChaptersFrom(topicId, fromChapterId);
	const removedTurnIds = new Set(discardChapters.flatMap((c) => c.turns).map((t) => t.id));

	await clearPostDebateComments(topicId);
	await rollbackBeliefsForRemovedTurns(topicId, removedTurnIds);
	await deleteChapterEngagements(topicId, discardChapters);

	// 章の発言が再生成されるため、破棄章の既存ファクトチェック結果を無効化する（6.2）
	for (const chapter of discardChapters) {
		await deleteFactCheckResult(topicId, chapter.id);
	}

	// 原本（章のターン）が再生成されるため、編集成果物も破棄して原本との不整合を残さない（Req 5.6）
	await clearEditedArtifact(topicId);
};

/** 指定章以降を破棄して付随データを消し、新しい世代で再開（running）する */
export const restartDebateFromChapter = async (
	topicId: string,
	chapterId: string
): Promise<string> => {
	await discardChaptersWithSideData(topicId, chapterId);
	return await updateDebatePhaseStatus(topicId, 'running');
};

/**
 * 討論を全章リセットする（付随データも全削除）。running にはしない（呼び出し側が別途 startDebate する）。
 * 章付随データの削除責務をサーバ1箇所へ集約するため、旧 FE 側 resetDebate の役割をここへ移管した。
 */
export const resetDebate = async (topicId: string): Promise<void> => {
	const chapters = await getChaptersByTopicId(topicId);
	const firstChapter = chapters[0];
	if (!firstChapter) return;
	await discardChaptersWithSideData(topicId, firstChapter.id);
};
