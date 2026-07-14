import { getFirestore } from 'firebase-admin/firestore';
import type { TopicForFirestore } from '../../types/topic.types.js';

const db = () => getFirestore();

export const getTopicById = async (id: string): Promise<TopicForFirestore | null> => {
	const snap = await db().doc(`topics/${id}`).get();
	if (!snap.exists) return null;
	return { ...(snap.data() as Omit<TopicForFirestore, 'id'>), id: snap.id };
};
