import { onSnapshot, doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '#lib/stores/firebase.ts';
import type { FactBase, FactBaseForFirestore } from '#lib/models/factBase/factBase.types.ts';

export const createFactBaseStore = (topicId: string) => {
	let data = $state<FactBase | null>(null);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		unsubscribe = onSnapshot(doc(db, 'topics', topicId, 'factBase', '0'), (snap) => {
			if (!snap.exists()) {
				data = null;
			} else {
				const persisted = snap.data() as FactBaseForFirestore;
				data = { facts: persisted.facts, generatedAt: persisted.generatedAt.toDate() };
			}
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	// 管理者の編集内容を factBase/0 に保存する（上書き・R2.4）。
	const save = async (factBase: FactBase): Promise<void> => {
		const persisted: FactBaseForFirestore = {
			facts: factBase.facts,
			generatedAt: Timestamp.fromDate(factBase.generatedAt)
		};
		await setDoc(doc(db, 'topics', topicId, 'factBase', '0'), persisted);
	};

	return {
		get data() {
			return data;
		},
		get isLoaded() {
			return isLoaded;
		},
		start,
		stop,
		save
	};
};
