import { getFirestore } from 'firebase-admin/firestore';
import { confirmPhaseGenerated } from '../../utils/topic-phase.js';

const db = () => getFirestore();

/**
 * 取材完了をサーバ側で判定し、採用（selected）ペルソナが1件以上ありその全員が
 * interview.status==='completed' のときだけ personas フェーズを generated に確定する
 * （confirmPhaseGenerated 経由で running/stopped 限定・冪等）。
 * 取材は採否に関わらず全員に走るが、selected は随時切替可能なため判定は採用ペルソナ基準にする。
 * 不採用ペルソナの取材状態（error / 未完）は判定に含めない。採用0件では確定しない
 * （空 every の true 化を防ぐ）。並列の各取材完了時に多重に呼ばれても、揃った時のみ遷移する。
 */
export const confirmInterviewsGeneratedIfAllComplete = async (
	topicId: string
): Promise<boolean> => {
	const snap = await db().collection(`topics/${topicId}/personas`).get();
	const targets = snap.docs.filter(
		(personaDoc) => (personaDoc.data() as { selected?: boolean }).selected
	);
	if (targets.length === 0) return false;
	const allCompleted = targets.every(
		(personaDoc) =>
			(personaDoc.data() as { interview?: { status?: string } }).interview?.status === 'completed'
	);
	if (!allCompleted) return false;
	return confirmPhaseGenerated(topicId, 'personas');
};
