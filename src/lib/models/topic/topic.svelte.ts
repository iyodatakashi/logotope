import {
	doc,
	updateDoc,
	writeBatch,
	Timestamp,
	getDocs,
	collection,
	deleteField,
	getDoc,
	addDoc
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '$lib/firebase.js';
import type { TopicDoc, StakeholderDoc } from './topic.types.js';
import type { PersonaData } from '../persona/persona.types.js';

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

	const generateStakeholders = async (): Promise<void> => {
		const fn = httpsCallable<{ title: string }, { stakeholders: StakeholderDoc[] }>(
			functions,
			'generateStakeholders',
			{ timeout: 310000 }
		);
		const { data } = await fn({ title: topic.title });
		await updateDoc(doc(db, 'topics', topicId), {
			stakeholders: { items: data.stakeholders, approved: false, createdAt: Timestamp.now() },
			updatedAt: Timestamp.now()
		});
	};

	const generatePersonas = async (): Promise<void> => {
		const stakeholders = topic.stakeholders?.items ?? [];
		const fn = httpsCallable<
			{ title: string; stakeholders: StakeholderDoc[] },
			{ personas: PersonaData[] }
		>(functions, 'generatePersonas', { timeout: 310000 });
		const { data } = await fn({ title: topic.title, stakeholders });
		await Promise.all(
			data.personas.map((p, i) =>
				addDoc(collection(db, 'topics', topicId, 'personas'), {
					topicId,
					sortOrder: i,
					approved: false,
					beliefs: [],
					createdAt: Timestamp.now(),
					...p
				})
			)
		);
	};

	const startDebate = async (): Promise<void> => {
		const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'startDebate', {
			timeout: 600000
		});
		await fn({ topicId });
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
		generateStakeholders,
		generatePersonas,
		startDebate,
		approveStakeholders,
		approveInterviews,
		publishDebate,
		resetToPhase1,
		resetToPhase2,
		resetToPhase3
	};
};

export type TopicStore = ReturnType<typeof createTopicStore>;
