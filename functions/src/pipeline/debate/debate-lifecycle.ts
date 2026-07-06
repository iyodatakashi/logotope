import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { discardChaptersFrom, getChaptersByTopicId } from './chapter.js';
import { rollbackAwarenessesForRemovedTurns } from './awareness.js';
import { deleteChapterEngagements } from './engagement.js';
import { clearPostDebateComments } from './post-debate-comments.js';
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

export type DebateActivation =
	| { status: 'active' }
	| { status: 'inactive' } // 停止・完了・未開始（従来の isDebateActive=false 相当）
	| { status: 'stale_generation'; currentRunId: string }; // 現行世代と不一致の旧タスク

/**
 * 討論ステップ入口の停止ゲート兼世代照合。topic doc を1回読み、アクティブ判定と runId 照合を
 * 同時に行う（追加の Firestore 読み取りを発生させない）。payload・topic doc の双方に runId が
 * ある場合のみ照合する後方互換規約は addTurn の世代照合と揃える。旧世代タスクは stale_generation
 * を返し、呼び出し元は副作用ゼロ・再エンキューなしで正常終了する（R9.1）。
 */
export const checkDebateActivation = async (
	topicId: string,
	runId: string
): Promise<DebateActivation> => {
	const snap = await db().doc(`topics/${topicId}`).get();
	if (!snap.exists) return { status: 'inactive' };
	const data = snap.data() as { phase?: PhaseKey; phaseStatus?: string; runId?: string };
	if (!(data.phase === 'debate' && data.phaseStatus === 'running')) return { status: 'inactive' };
	if (data.runId && runId && data.runId !== runId) {
		return { status: 'stale_generation', currentRunId: data.runId };
	}
	return { status: 'active' };
};

/**
 * 討論フェーズが完了（generated 到達）しているかを判定する。編集開始の前提ゲート（Req 5.4）。
 * phase が editing に進んでいる場合は討論を完了して次段へ移っているため完了扱い（編集の再実行を許可する）。
 */
export const isDebateCompleted = async (topicId: string): Promise<boolean> => {
	const snap = await db().doc(`topics/${topicId}`).get();
	if (!snap.exists) return false;
	const data = snap.data() as { phase?: PhaseKey; phaseStatus?: string };
	if (data.phase === 'editing') return true;
	return data.phase === 'debate' && data.phaseStatus === 'generated';
};

/**
 * 指定章以降を破棄し、その章に紐づく付随データ（コメント・気づき・engagements）を
 * まとめて削除する。reset（全章）と restart（指定章以降）で共通の削除責務をここに集約する。
 */
const discardChaptersWithSideData = async (
	topicId: string,
	fromChapterId: string
): Promise<void> => {
	const discardChapters = await discardChaptersFrom(topicId, fromChapterId);
	const removedTurnIds = new Set(
		discardChapters.flatMap((chapter) => chapter.turns).map((turn) => turn.id)
	);

	await clearPostDebateComments(topicId);
	// 初期信念は不変。破棄ターンに紐づく気づき（awareness）のみを巻き戻す（1.3）
	await rollbackAwarenessesForRemovedTurns(topicId, removedTurnIds);
	await deleteChapterEngagements(topicId, discardChapters);

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
