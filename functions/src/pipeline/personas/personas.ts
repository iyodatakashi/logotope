import { getFirestore } from 'firebase-admin/firestore';
import type { Persona } from '../../types/persona.types.js';

const db = () => getFirestore();

export const getPersonasByTopicId = async (topicId: string): Promise<Persona[]> => {
	const snap = await db().collection(`topics/${topicId}/personas`).orderBy('sortOrder', 'asc').get();
	return snap.docs.map((docSnap) => {
		const data = docSnap.data() as Omit<Persona, 'specificRole' | 'interviewRecord'> & { specificRole?: string; interview?: { interviewRecord: string } };
		return { ...data, id: docSnap.id, specificRole: data.specificRole ?? data.stakeholderRole, interviewRecord: data.interview?.interviewRecord };
	});
};
