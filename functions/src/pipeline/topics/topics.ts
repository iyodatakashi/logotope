import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { FetchedSourceContent, Topic } from '../../types/topic.types.js';

const db = () => getFirestore();

export const getTopicById = async (id: string): Promise<Topic | null> => {
	const snap = await db().doc(`topics/${id}`).get();
	if (!snap.exists) return null;
	const data = snap.data() as {
		title: string;
		description?: string;
		sourceUrls?: string[];
		fetchedSourceContents?: FetchedSourceContent[];
		createdAt: Timestamp;
		updatedAt: Timestamp;
	};
	return {
		id: snap.id,
		title: data.title,
		...(data.description !== undefined && { description: data.description }),
		...(data.sourceUrls !== undefined && { sourceUrls: data.sourceUrls }),
		...(data.fetchedSourceContents !== undefined && {
			fetchedSourceContents: data.fetchedSourceContents
		}),
		createdAt: data.createdAt?.toDate().toISOString() ?? '',
		updatedAt: data.updatedAt?.toDate().toISOString() ?? ''
	};
};
