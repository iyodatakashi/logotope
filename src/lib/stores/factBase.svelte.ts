import { onSnapshot, doc, setDoc } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { FactBaseForFirestore } from '$lib/models/factBase/factBase.types';

export const createFactBaseStore = (topicId: string) => {
	let data = $state<FactBaseForFirestore | null>(null);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		unsubscribe = onSnapshot(doc(db, 'topics', topicId, 'factBase', '0'), (snap) => {
			data = snap.exists() ? (snap.data() as FactBaseForFirestore) : null;
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	// 管理者の編集内容を factBase/0 に保存する（上書き・R2.4）。
	const save = async (factBase: FactBaseForFirestore): Promise<void> => {
		await setDoc(doc(db, 'topics', topicId, 'factBase', '0'), factBase);
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
