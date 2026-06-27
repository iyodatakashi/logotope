import { getFirestore, Timestamp } from 'firebase-admin/firestore';

/**
 * フェーズ1〜4の生成完了確定と状態書込をサーバ側で一元化するヘルパー。
 * 全フェーズで not_started → running → generated/stopped の状態遷移を1箇所で担保し、
 * 完了（generated）は running 限定の冪等トランザクションでのみ確定する
 * （討論フェーズの persistPostDebateComments と同じ規範）。
 */
export type GeneratePhase = 1 | 2 | 3 | 4;

const db = () => getFirestore();

/**
 * phaseStatus が running のときだけ generated へ遷移させる（冪等・終端）。
 * 既に generated・stopped・承認等で phase 前進済みの場合は上書きしない（no-op）。
 * ドキュメント不存在時も no-op。遷移したら true、しなければ false を返す。
 */
export const confirmPhaseGenerated = async (
	topicId: string,
	phase: GeneratePhase
): Promise<boolean> => {
	const ref = db().doc(`topics/${topicId}`);
	return db().runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		if (!snap.exists) return false;
		const data = snap.data() as { phaseStatus?: string };
		if (data.phaseStatus !== 'running') return false;
		tx.update(ref, { phase, phaseStatus: 'generated', updatedAt: Timestamp.now() });
		return true;
	});
};

/**
 * フェーズの開始（running）・停止（stopped）を書き込む。
 * 完了確定（generated）はこの関数では書けない（必ず confirmPhaseGenerated 経由）。
 */
export const setTopicPhaseStatus = async (
	topicId: string,
	phase: GeneratePhase,
	phaseStatus: 'running' | 'stopped'
): Promise<void> => {
	await db().doc(`topics/${topicId}`).update({ phase, phaseStatus, updatedAt: Timestamp.now() });
};
