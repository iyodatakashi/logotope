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
import { db } from '$lib/firebase.js';
import { nanoid } from 'nanoid';
import type { TopicDoc } from '$lib/models/topic/topic.types';
import { createTopicStore, type TopicStore } from '$lib/models/topic/topic.svelte.js';

const create = () => {
	let topics = $state<TopicStore[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		if (unsubscribe) return;
		const q = query(collection(db, 'topics'), orderBy('createdAt', 'desc'));
		unsubscribe = onSnapshot(q, (snap) => {
			topics = snap.docs.map((d) => createTopicStore({ id: d.id, ...d.data() } as TopicDoc));
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	const addTopic = async (title: string): Promise<string> => {
		const id = nanoid();
		const now = Timestamp.now();
		await setDoc(doc(db, 'topics', id), {
			id,
			title,
			status: 'pending',
			createdAt: now,
			updatedAt: now
		});
		return id;
	};

	const deleteTopic = async (topicId: string): Promise<void> => {
		const personasSnap = await getDocs(collection(db, 'topics', topicId, 'personas'));
		const all = [
			...personasSnap.docs.map((d) => d.ref),
			doc(db, 'topics', topicId, 'sessions', '0'),
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
