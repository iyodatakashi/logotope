import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { StakeholderDoc } from '$lib/models/topic/topic.types';

export const createStakeholdersStore = (topicId: string) => {
	let stakeholders = $state<StakeholderDoc[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		unsubscribe = onSnapshot(doc(db, 'topics', topicId, 'stakeholders', '0'), (snap) => {
			const data = snap.exists() ? (snap.data() as { stakeholders: StakeholderDoc[] }) : null;
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
