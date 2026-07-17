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
import type { Topic, TopicForFirestore } from '$lib/models/topic/topic.types';
import { createTopicStates, type TopicStates } from '$lib/models/topic/createTopic.svelte';

// Firestore 永続形からアプリ層型へ（Timestamp → Date 変換）。利用箇所は当ストアのみ。
const toTopic = (topicDoc: TopicForFirestore): Topic => ({
	...topicDoc,
	fetchedSourceContents: topicDoc.fetchedSourceContents?.map((source) => ({
		...source,
		fetchedAt: source.fetchedAt.toDate()
	})),
	sourceContentsFetchedAt: topicDoc.sourceContentsFetchedAt?.toDate(),
	createdAt: topicDoc.createdAt.toDate(),
	updatedAt: topicDoc.updatedAt.toDate(),
	// 欠落（フィールド未設定の既存トピック）は非公開に正規化し、アプリ層に optional を漏らさない。
	published: topicDoc.published ?? false,
	publishedAt: topicDoc.publishedAt?.toDate()
});

const create = () => {
	let topics = $state<TopicStates[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		if (unsubscribe) return;
		const q = query(collection(db, 'topics'), orderBy('createdAt', 'desc'));
		unsubscribe = onSnapshot(q, (snap) => {
			topics = snap.docs.map((docSnapshot) =>
				createTopicStates(
					toTopic({ ...docSnapshot.data(), id: docSnapshot.id } as TopicForFirestore)
				)
			);
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	// 新規トピックは題名だけで作る。説明・参考URLはテーマ設定フェーズの画面で入力する。
	const addTopic = async (title: string): Promise<string> => {
		const id = nanoid();
		const now = Timestamp.now();
		await setDoc(doc(db, 'topics', id), {
			id,
			title,
			phase: 'theme',
			phaseStatus: 'not_started',
			createdAt: now,
			updatedAt: now
		});
		return id;
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
		deleteTopic
	};
};

export const topicsStore = create();
