import { onSnapshot, collection, query, orderBy, doc, updateDoc, writeBatch, Timestamp } from 'firebase/firestore';
import { db } from '$lib/firebase.js';
import type { PersonaDoc } from '$lib/types/index.js';

export const createPersonasStore = (topicId: string) => {
	let personas = $state<PersonaDoc[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		const q = query(
			collection(db, 'topics', topicId, 'personas'),
			orderBy('sortOrder', 'asc')
		);
		unsubscribe = onSnapshot(q, (snap) => {
			personas = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PersonaDoc);
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	const approvePersonas = async (): Promise<void> => {
		const batch = writeBatch(db);
		personas.forEach((p) => {
			batch.update(doc(db, 'topics', topicId, 'personas', p.id), { approved: true });
		});
		batch.update(doc(db, 'topics', topicId), {
			status: 'interviewing',
			updatedAt: Timestamp.now()
		});
		await batch.commit();
	};

	const resetPersonas = async (): Promise<void> => {
		const batch = writeBatch(db);
		personas.forEach((p) => {
			batch.delete(doc(db, 'topics', topicId, 'personas', p.id));
		});
		batch.update(doc(db, 'topics', topicId), {
			status: 'surveying',
			updatedAt: Timestamp.now()
		});
		await batch.commit();
	};

	return {
		get personas() {
			return personas;
		},
		get isLoaded() {
			return isLoaded;
		},
		start,
		stop,
		approvePersonas,
		resetPersonas
	};
};
