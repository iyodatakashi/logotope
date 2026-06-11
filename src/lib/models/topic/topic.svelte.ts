import {
	doc,
	updateDoc,
	writeBatch,
	Timestamp,
	getDocs,
	collection,
	deleteField,
	getDoc
} from 'firebase/firestore';
import { db } from '$lib/firebase.js';
import type { TopicDoc } from './topic.types';

export const createTopicStore = (topicDoc: TopicDoc) => {
	let topic = $state<TopicDoc>(topicDoc);
	const topicId = topicDoc.id;

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

	const cancelRunningDebate = async (): Promise<void> => {
		const sessionRef = doc(db, 'topics', topicId, 'sessions', '0');
		const snap = await getDoc(sessionRef);
		if (snap.exists() && snap.data()?.status === 'debating') {
			await updateDoc(sessionRef, { status: 'cancelled' });
		}
	};

	const resetToPhase1 = async (): Promise<void> => {
		await cancelRunningDebate();
		const personasSnap = await getDocs(collection(db, 'topics', topicId, 'personas'));
		const batch = writeBatch(db);
		personasSnap.docs.forEach((d) => batch.delete(d.ref));
		batch.delete(doc(db, 'topics', topicId, 'sessions', '0'));
		batch.update(doc(db, 'topics', topicId), { status: 'surveying', updatedAt: Timestamp.now() });
		await batch.commit();
	};

	const resetToPhase2 = async (): Promise<void> => {
		await cancelRunningDebate();
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
		await cancelRunningDebate();
		const batch = writeBatch(db);
		batch.delete(doc(db, 'topics', topicId, 'sessions', '0'));
		batch.update(doc(db, 'topics', topicId), {
			status: 'interviewing',
			updatedAt: Timestamp.now()
		});
		await batch.commit();
	};

	return {
		get id() { return topic.id; },
		get title() { return topic.title; },
		get status() { return topic.status; },
		get createdAt() { return topic.createdAt; },
		get updatedAt() { return topic.updatedAt; },
		get publishedAt() { return topic.publishedAt; },
		get personaCount() { return topic.personaCount; },
		get stakeholders() { return topic.stakeholders; },
		_set(data: TopicDoc) {
			topic = data;
		},
		approveStakeholders,
		approveInterviews,
		publishDebate,
		resetToPhase1,
		resetToPhase2,
		resetToPhase3
	};
};

export type TopicStore = ReturnType<typeof createTopicStore>;
