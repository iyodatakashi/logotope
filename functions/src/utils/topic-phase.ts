import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { PhaseSlug, PhaseStatus } from '../types/phase.types.js';

/**
 * 生成確定を持つフェーズ（fact-research/personas/chapters）の生成完了確定と
 * 状態書込をサーバ側で一元化するヘルパー。
 * 全フェーズで not_started → running → generated/stopped の状態遷移を1箇所で担保し、
 * 完了（generated）は running 限定の冪等トランザクションでのみ確定する
 * （討論フェーズの persistPostDebateComments と同じ規範）。
 */
export type GeneratePhase = Extract<PhaseSlug, 'fact-research' | 'personas' | 'chapters'>;

const db = () => getFirestore();

/**
 * phaseStatus が running または stopped のときに generated へ遷移させる（冪等・終端）。
 * 呼び出し側が「全件完了」を確認済みのため、クライアントのタイムアウト等で stopped が付いた
 * 場合でも、完了が真実なら generated に確定してよい（running 限定だと全件完了でも stopped に
 * 固着し承認へ進めない不具合があった）。ただし phase が対象から前進済み（承認等）なら巻き戻さない。
 * generated・not_started は対象外。ドキュメント不存在時も no-op。遷移したら true、しなければ false。
 */
export const confirmPhaseGenerated = async (
	topicId: string,
	phase: GeneratePhase
): Promise<boolean> => {
	const ref = db().doc(`topics/${topicId}`);
	return db().runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		if (!snap.exists) return false;
		const data = snap.data() as { phase?: PhaseSlug; phaseStatus?: PhaseStatus };
		// 対象フェーズから前進済み（承認で phase が進んだ等）なら触らない＝巻き戻し防止
		if (data.phase !== phase) return false;
		if (data.phaseStatus !== 'running' && data.phaseStatus !== 'stopped') return false;
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
