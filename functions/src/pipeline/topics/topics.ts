import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Topic } from '../../types/topic.types.js';

export const getTopicById = async (id: string): Promise<Topic | null> => {
	const snap = await getFirestore().doc(`topics/${id}`).get();
	if (!snap.exists) return null;
	const data = snap.data() as { title: string; createdAt: Timestamp; updatedAt: Timestamp };
	return {
		id: snap.id,
		title: data.title,
		createdAt: data.createdAt?.toDate().toISOString() ?? '',
		updatedAt: data.updatedAt?.toDate().toISOString() ?? '',
	};
};
