import { onSnapshot, collection, query, where, orderBy, doc, setDoc, deleteDoc, writeBatch, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '$lib/firebase.js';
import { nanoid } from 'nanoid';
import type { TopicDoc } from '$lib/types/index.js';

export const createTopicsStore = () => {
	let topics = $state<TopicDoc[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		const q = query(collection(db, 'topics'), orderBy('createdAt', 'desc'));
		unsubscribe = onSnapshot(q, (snap) => {
			topics = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TopicDoc);
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	const createTopic = async (title: string): Promise<string> => {
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
		start,
		stop,
		createTopic,
		deleteTopic
	};
};

export const createPublishedTopicsStore = () => {
	let topics = $state<TopicDoc[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		const q = query(collection(db, 'topics'), where('status', '==', 'published'));
		unsubscribe = onSnapshot(q, (snap) => {
			topics = snap.docs
				.map((d) => ({ id: d.id, ...d.data() }) as TopicDoc)
				.sort(
					(a, b) =>
						(b.publishedAt?.seconds ?? b.updatedAt.seconds) -
						(a.publishedAt?.seconds ?? a.updatedAt.seconds)
				);
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	return {
		get topics() {
			return topics;
		},
		get isLoaded() {
			return isLoaded;
		},
		start,
		stop
	};
};
