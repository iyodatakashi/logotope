import { getFirestore } from 'firebase-admin/firestore';

const db = () => getFirestore();

/**
 * 章立て（chapters コレクションと付随分析 chapterAnalysis/0）を破棄する。phase / phaseStatus は
 * 書き換えない。既に無いものは no-op（冪等）。クライアント側 resetChapters と破棄範囲を1対1で一致させる。
 * 討論の途中破棄（discardChaptersFrom：turns のみクリア）とは別責務で、ここでは章構造ごと削除する。
 */
export const discardChaptersWithAnalysis = async (topicId: string): Promise<void> => {
	const snap = await db().collection(`topics/${topicId}/chapters`).get();
	for (const docSnap of snap.docs) {
		await docSnap.ref.delete();
	}
	await db().doc(`topics/${topicId}/chapterAnalysis/0`).delete();
};
