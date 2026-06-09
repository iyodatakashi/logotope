import { onSnapshot, doc, updateDoc, deleteDoc, writeBatch, Timestamp, getDocs, collection, deleteField } from 'firebase/firestore';
import { db } from '$lib/firebase.js';
import type { TopicDoc } from '$lib/types/index.js';

export const createTopicStore = (topicId: string) => {
	let topic = $state<TopicDoc | null>(null);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		unsubscribe = onSnapshot(doc(db, 'topics', topicId), (snap) => {
			topic = snap.exists() ? ({ id: snap.id, ...snap.data() } as TopicDoc) : null;
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	const approveStakeholders = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId), {
			'stakeholders.approved': true,
			status: 'generating_personas',
			updatedAt: Timestamp.now()
		});
	};

	const approveInterviews = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId), {
			status: 'debating',
			updatedAt: Timestamp.now()
		});
	};

	const publishDebate = async (): Promise<void> => {
		const personasSnap = await getDocs(collection(db, 'topics', topicId, 'personas'));
		const personaCount = personasSnap.size;
		const now = Timestamp.now();
		const batch = writeBatch(db);
		batch.update(doc(db, 'topics', topicId), {
			status: 'published',
			personaCount,
			publishedAt: now,
			updatedAt: now
		});
		batch.update(doc(db, 'topics', topicId, 'sessions', '0'), {
			publishedAt: now
		});
		await batch.commit();
	};

	const resetToPhase1 = async (): Promise<void> => {
		const personasSnap = await getDocs(collection(db, 'topics', topicId, 'personas'));
		const batch = writeBatch(db);
		personasSnap.docs.forEach((d) => batch.delete(d.ref));
		batch.delete(doc(db, 'topics', topicId, 'sessions', '0'));
		batch.update(doc(db, 'topics', topicId), { status: 'surveying', updatedAt: Timestamp.now() });
		await batch.commit();
	};

	const resetToPhase2 = async (): Promise<void> => {
		const personasSnap = await getDocs(collection(db, 'topics', topicId, 'personas'));
		const batch = writeBatch(db);
		personasSnap.docs.forEach((d) =>
			batch.update(d.ref, { interview: deleteField(), beliefs: [] })
		);
		batch.delete(doc(db, 'topics', topicId, 'sessions', '0'));
		batch.update(doc(db, 'topics', topicId), {
			status: 'generating_personas',
			updatedAt: Timestamp.now()
		});
		await batch.commit();
	};

	const resetToPhase3 = async (): Promise<void> => {
		const batch = writeBatch(db);
		batch.delete(doc(db, 'topics', topicId, 'sessions', '0'));
		batch.update(doc(db, 'topics', topicId), {
			status: 'interviewing',
			updatedAt: Timestamp.now()
		});
		await batch.commit();
	};

	const resetDebate = async (): Promise<void> => {
		await deleteDoc(doc(db, 'topics', topicId, 'sessions', '0'));
		await updateDoc(doc(db, 'topics', topicId), {
			status: 'interviewing',
			updatedAt: Timestamp.now()
		});
	};

	return {
		get topic() {
			return topic;
		},
		get isLoaded() {
			return isLoaded;
		},
		start,
		stop,
		approveStakeholders,
		approveInterviews,
		publishDebate,
		resetToPhase1,
		resetToPhase2,
		resetToPhase3,
		resetDebate
	};
};
