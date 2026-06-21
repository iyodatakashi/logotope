import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { StakeholderForFirestore } from '$lib/models/topic/topic.types';

export const createStakeholdersStore = (topicId: string) => {
	let stakeholders = $state<StakeholderForFirestore[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		unsubscribe = onSnapshot(doc(db, 'topics', topicId, 'stakeholders', '0'), (snap) => {
			const data = snap.exists()
				? (snap.data() as { stakeholders: StakeholderForFirestore[] })
				: null;
			stakeholders = data?.stakeholders ?? [];
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	return {
		get stakeholders() {
			return stakeholders;
		},
		get isLoaded() {
			return isLoaded;
		},
		start,
		stop
	};
};
