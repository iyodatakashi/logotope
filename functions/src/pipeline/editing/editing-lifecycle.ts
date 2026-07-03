import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { clearEditedArtifact, readEditedChapters } from './edited-repository.js';
import type { PhaseKey } from '../../types/topic.types.js';

// 編集ランのライフサイクル: 開始（破棄＋実行中化＋新世代）と完了確定（全章成功→generated / 失敗残存→stopped）。
// 生ディベートは読み取りのみ。編集フェーズ（phase 6）の phaseStatus と runId のみを更新する。

const db = () => getFirestore();

/**
 * 編集ランを開始する。既存の編集成果物を即時破棄し、編集フェーズを実行中にして新しい世代 runId を発行する。
 * 再実行時も同じ経路を通り、旧成果物は開始時点で必ず消える（UX フィードバックと整合の両立）。
 */
export const startEditingRun = async (topicId: string): Promise<string> => {
	await clearEditedArtifact(topicId);
	const runId = nanoid();
	await db()
		.doc(`topics/${topicId}`)
		.update({ phase: 'editing', phaseStatus: 'running', runId, updatedAt: Timestamp.now() });
	return runId;
};

/**
 * 編集を未実行状態へ戻す（リセット）。編集成果物を破棄し、編集フェーズを not_started にする。
 * 討論には触れず、原本は不変。再度 startEditingRun で編集を開始できる。
 */
export const resetEditingRun = async (topicId: string): Promise<void> => {
	await clearEditedArtifact(topicId);
	await db()
		.doc(`topics/${topicId}`)
		.update({ phase: 'editing', phaseStatus: 'not_started', updatedAt: Timestamp.now() });
};

/**
 * 終端失敗で編集ランを停止（stopped）にする。phase 6・runId 一致・phaseStatus running のときのみ遷移し、
 * 旧世代・前進済みを弾く（新世代の編集を巻き込まない）。再実行ボタンで復帰できる。
 */
export const stopEditingRun = async (topicId: string, runId: string): Promise<void> => {
	const ref = db().doc(`topics/${topicId}`);
	await db().runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		if (!snap.exists) return;
		const data = snap.data() as { phase?: PhaseKey; phaseStatus?: string; runId?: string };
		if (data.phase !== 'editing' || data.runId !== runId || data.phaseStatus !== 'running') return;
		tx.update(ref, { phaseStatus: 'stopped', updatedAt: Timestamp.now() });
	});
};

/** 編集ランが稼働中（phase 6・phaseStatus running・runId 一致）かを判定する。旧世代タスクを弾く */
export const isEditingActive = async (topicId: string, runId: string): Promise<boolean> => {
	const snap = await db().doc(`topics/${topicId}`).get();
	if (!snap.exists) return false;
	const data = snap.data() as { phase?: PhaseKey; phaseStatus?: string; runId?: string };
	return data.phase === 'editing' && data.phaseStatus === 'running' && data.runId === runId;
};

/**
 * 編集ランを確定する。全 editedChapters が completed なら generated、1 章でも failed が残れば stopped。
 * phase 6・runId 一致・phaseStatus ∈ {running, stopped} のときのみ遷移し、巻き戻し（generated→stopped 等）を防ぐ。
 * 世代不一致・前進済みは書き込まず noop を返す（冪等）。
 */
export const finalizeEditingRun = async (
	topicId: string,
	runId: string
): Promise<'generated' | 'stopped' | 'noop'> => {
	const chapters = await readEditedChapters(topicId);
	const allCompleted = chapters.length > 0 && chapters.every((c) => c.status === 'completed');
	const nextStatus: 'generated' | 'stopped' = allCompleted ? 'generated' : 'stopped';

	const ref = db().doc(`topics/${topicId}`);
	return await db().runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		if (!snap.exists) return 'noop';
		const data = snap.data() as { phase?: PhaseKey; phaseStatus?: string; runId?: string };
		if (
			data.phase !== 'editing' ||
			data.runId !== runId ||
			(data.phaseStatus !== 'running' && data.phaseStatus !== 'stopped')
		) {
			return 'noop';
		}
		tx.update(ref, { phaseStatus: nextStatus, updatedAt: Timestamp.now() });
		return nextStatus;
	});
};
