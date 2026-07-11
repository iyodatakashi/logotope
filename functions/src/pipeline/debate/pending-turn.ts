import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { PendingTurn, PendingTurnStatus } from '../../types/chapter.types.js';

const db = () => getFirestore();

const chapterRef = (topicId: string, chapterId: string) =>
	db().doc(`topics/${topicId}/chapters/${chapterId}`);

/**
 * 生成中の persona ターンを chapter.pendingTurn に generating で先行作成する（2.1）。
 * turns[] には入れず frontier から隔離する。次の発言者は pendingTurn.personaId で表現する。
 */
export const setPendingTurn = async (params: {
	topicId: string;
	chapterId: string;
	pendingTurn: PendingTurn;
}): Promise<void> => {
	await chapterRef(params.topicId, params.chapterId).update({ pendingTurn: params.pendingTurn });
};

/**
 * pendingTurn の生成段階を更新する（fact-checking へ・2.2）。
 * 自タスクが発番した id と一致するときのみ更新し、後続 frontier の pendingTurn を誤更新しない。
 */
export const updatePendingTurnStatus = async (params: {
	topicId: string;
	chapterId: string;
	id: string;
	status: PendingTurnStatus;
}): Promise<void> => {
	const ref = chapterRef(params.topicId, params.chapterId);
	await db().runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		const pending = (snap.data() as { pendingTurn?: PendingTurn } | undefined)?.pendingTurn;
		if (!pending || pending.id !== params.id) return;
		tx.update(ref, { pendingTurn: { ...pending, status: params.status } });
	});
};

/**
 * 未確定の pendingTurn を削除する（停止・失敗・敗者・3.4/3.5/3.6）。
 * compare-and-clear：自タスクが発番した id と一致するときのみ削除し、後続 frontier の正当な
 * pendingTurn を誤消去しない。
 */
export const clearPendingTurn = async (params: {
	topicId: string;
	chapterId: string;
	id: string;
}): Promise<void> => {
	const ref = chapterRef(params.topicId, params.chapterId);
	await db().runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		const pending = (snap.data() as { pendingTurn?: PendingTurn } | undefined)?.pendingTurn;
		if (!pending || pending.id !== params.id) return;
		tx.update(ref, { pendingTurn: FieldValue.delete() });
	});
};
