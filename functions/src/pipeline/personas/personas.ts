import { getFirestore } from 'firebase-admin/firestore';
import type { Persona } from '../../types/persona.types.js';

const db = () => getFirestore();

export const getPersonasByTopicId = async (topicId: string): Promise<Persona[]> => {
	const snap = await db()
		.collection(`topics/${topicId}/personas`)
		.orderBy('sortOrder', 'asc')
		.get();
	return snap.docs.map((docSnap) => {
		const data = docSnap.data() as Omit<Persona, 'specificRole' | 'interviewRecord'> & {
			specificRole?: string;
			interview?: { interviewRecord: string };
		};
		return {
			...data,
			id: docSnap.id,
			specificRole: data.specificRole ?? data.stakeholderRole,
			interviewRecord: data.interview?.interviewRecord
		};
	});
};

/**
 * ステークホルダー（stakeholders/0）を破棄する。phase / phaseStatus は書き換えない。
 * 既に無い場合は no-op（冪等）。再生成時のサーバ権威な下流破棄で使う。
 */
export const discardStakeholders = async (topicId: string): Promise<void> => {
	await db().doc(`topics/${topicId}/stakeholders/0`).delete();
};

/**
 * ペルソナ（personas サブコレクション。取材記録・信念もペルソナ文書に含まれる）を全削除する。
 * phase / phaseStatus は書き換えない。空コレクションは no-op（冪等）。
 */
export const discardPersonas = async (topicId: string): Promise<void> => {
	const snap = await db().collection(`topics/${topicId}/personas`).get();
	for (const docSnap of snap.docs) {
		await docSnap.ref.delete();
	}
};
