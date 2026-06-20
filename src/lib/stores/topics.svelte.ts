import {
	onSnapshot,
	collection,
	query,
	orderBy,
	doc,
	setDoc,
	writeBatch,
	getDocs,
	Timestamp
} from 'firebase/firestore';
import { db } from '$lib/firebase';
import { nanoid } from 'nanoid';
import type { TopicDoc } from '$lib/models/topic/topic.types';
import { createTopicStates, type Topic } from '$lib/models/topic/createTopic.svelte';

const create = () => {
	let topics = $state<Topic[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		if (unsubscribe) return;
		const q = query(collection(db, 'topics'), orderBy('createdAt', 'desc'));
		unsubscribe = onSnapshot(q, (snap) => {
			topics = snap.docs.map((d) => createTopicStates({ ...d.data(), id: d.id } as TopicDoc));
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	const addTopic = async (title: string, description?: string, sourceUrls?: string[]): Promise<string> => {
		const id = nanoid();
		const now = Timestamp.now();
		await setDoc(doc(db, 'topics', id), {
			id,
			title,
			...(description?.trim() && { description }),
			...(sourceUrls?.length && { sourceUrls }),
			phase: 1,
			phaseStatus: 'not_started',
			createdAt: now,
			updatedAt: now
		});
		return id;
	};

	const deleteTopic = async (topicId: string): Promise<void> => {
		const [personasSnap, chaptersSnap, engagementsSnap] = await Promise.all([
			getDocs(collection(db, 'topics', topicId, 'personas')),
			getDocs(collection(db, 'topics', topicId, 'chapters')),
			getDocs(collection(db, 'topics', topicId, 'engagements'))
		]);
		const all = [
			...personasSnap.docs.map((d) => d.ref),
			...chaptersSnap.docs.map((d) => d.ref),
			...engagementsSnap.docs.map((d) => d.ref),
			doc(db, 'topics', topicId, 'chapterAnalysis', '0'),
			doc(db, 'topics', topicId, 'postDebateComments', '0'),
			doc(db, 'topics', topicId)
		];
		for (let i = 0; i < all.length; i += 500) {
			const batch = writeBatch(db);
			all.slice(i, i + 500).forEach((ref) => batch.delete(ref));
			await batch.commit();
		}
	};

	return {
		get topics() {
			return topics;
		},
		get isLoaded() {
			return isLoaded;
		},
		getById: (id: string) => topics.find((ts) => ts.id === id),
		start,
		stop,
		addTopic,
		deleteTopic
	};
};

export const topicsStore = create();
