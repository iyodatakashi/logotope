import { getFirestore } from 'firebase-admin/firestore';
import type { Persona, PersonaForFirestore } from '../../types/persona.types.js';

const db = () => getFirestore();

// Firestore のペルソナ永続形（PersonaForFirestore）をランタイム Persona へ写す（interview オブジェクトの
// interviewRecord への平坦化）。単体読み取りと全件読み取りで同じ写像を使う。
// role は直参照する（総称 stakeholderRole や旧 specificRole への導出・フォールバックは持たない・恒久排除）。
export const toPersona = (id: string, data: PersonaForFirestore): Persona => {
	const { interview, ...rest } = data;
	return {
		...rest,
		id,
		interviewRecord: interview?.interviewRecord
	};
};

export const getPersonasByTopicId = async (topicId: string): Promise<Persona[]> => {
	const snap = await db()
		.collection(`topics/${topicId}/personas`)
		.orderBy('sortOrder', 'asc')
		.get();
	return snap.docs.map((docSnap) => toPersona(docSnap.id, docSnap.data() as PersonaForFirestore));
};

/** 単一ペルソナを id で読む。未存在なら null（サーバ権威で自データを読むための単体リーダー）。 */
export const getPersonaById = async (
	topicId: string,
	personaId: string
): Promise<Persona | null> => {
	const snap = await db().doc(`topics/${topicId}/personas/${personaId}`).get();
	if (!snap.exists) return null;
	return toPersona(snap.id, snap.data() as PersonaForFirestore);
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
