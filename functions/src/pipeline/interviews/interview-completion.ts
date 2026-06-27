import { getFirestore } from 'firebase-admin/firestore';
import { confirmPhaseGenerated } from '../../utils/topic-phase.js';

const db = () => getFirestore();

/**
 * 全ペルソナの取材完了をサーバ側で判定し、件数>0 かつ全件 interview.status==='completed'
 * のときだけフェーズ3を generated に確定する（confirmPhaseGenerated 経由で running 限定・冪等）。
 * error / in_progress / 未設定が1件でも残るときは no-op。並列の各 runInterview 完了時に
 * 多重に呼ばれても、最後の completed 確定時のみ generated へ遷移する。
 */
export const confirmInterviewsGeneratedIfAllComplete = async (
	topicId: string
): Promise<boolean> => {
	const snap = await db().collection(`topics/${topicId}/personas`).get();
	if (snap.docs.length === 0) return false;
	const allCompleted = snap.docs.every(
		(d) => (d.data() as { interview?: { status?: string } }).interview?.status === 'completed'
	);
	if (!allCompleted) return false;
	return confirmPhaseGenerated(topicId, 3);
};
