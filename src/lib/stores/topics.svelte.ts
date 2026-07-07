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
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '$lib/firebase';
import { nanoid } from 'nanoid';
import type { TopicForFirestore, TopicInput } from '$lib/models/topic/topic.types';
import { createTopicStates, type Topic } from '$lib/models/topic/createTopic.svelte';

// Firestore 永続形からアプリ層型へ（Timestamp → Date 変換）。利用箇所は当ストアのみ。
const topicFromFirestore = (topicDoc: TopicForFirestore): TopicInput => ({
	...topicDoc,
	fetchedSourceContents: topicDoc.fetchedSourceContents?.map((source) => ({
		...source,
		fetchedAt: source.fetchedAt.toDate()
	})),
	sourceContentsFetchedAt: topicDoc.sourceContentsFetchedAt?.toDate(),
	createdAt: topicDoc.createdAt.toDate(),
	updatedAt: topicDoc.updatedAt.toDate(),
	publishedAt: topicDoc.publishedAt?.toDate()
});

const create = () => {
	let topics = $state<Topic[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		if (unsubscribe) return;
		const q = query(collection(db, 'topics'), orderBy('createdAt', 'desc'));
		unsubscribe = onSnapshot(q, (snap) => {
			topics = snap.docs.map((docSnapshot) =>
				createTopicStates(
					topicFromFirestore({ ...docSnapshot.data(), id: docSnapshot.id } as TopicForFirestore)
				)
			);
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	const addTopic = async (
		title: string,
		description?: string,
		sourceUrls?: string[]
	): Promise<string> => {
		const id = nanoid();
		const now = Timestamp.now();
		await setDoc(doc(db, 'topics', id), {
			id,
			title,
			...(description?.trim() && { description }),
			...(sourceUrls?.length && { sourceUrls }),
			phase: 'fact-research',
			phaseStatus: 'not_started',
			createdAt: now,
			updatedAt: now
		});
		return id;
	};

	// 参考URLの本文取得は topic エンティティに属する操作。UI から callable を直呼びせず store に集約する。
	const fetchSourceContents = async (topicId: string): Promise<void> => {
		const callable = httpsCallable(functions, 'fetchSourceContents');
		await callable({ topicId });
	};

	const deleteTopic = async (topicId: string): Promise<void> => {
		const [personasSnap, chaptersSnap] = await Promise.all([
			getDocs(collection(db, 'topics', topicId, 'personas')),
			getDocs(collection(db, 'topics', topicId, 'chapters'))
		]);
		const chapterEngagementSnaps = await Promise.all(
			chaptersSnap.docs.map((docSnapshot) =>
				getDocs(collection(db, 'topics', topicId, 'chapters', docSnapshot.id, 'engagements'))
			)
		);
		const all = [
			...personasSnap.docs.map((docSnapshot) => docSnapshot.ref),
			...chaptersSnap.docs.map((docSnapshot) => docSnapshot.ref),
			...chapterEngagementSnaps.flatMap((snap) => snap.docs.map((docSnapshot) => docSnapshot.ref)),
			doc(db, 'topics', topicId, 'chapterAnalysis', '0'),
			doc(db, 'topics', topicId, 'editorial', '0'),
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
		getById: (id: string) => topics.find((topic) => topic.id === id),
		start,
		stop,
		addTopic,
		fetchSourceContents,
		deleteTopic
	};
};

export const topicsStore = create();
