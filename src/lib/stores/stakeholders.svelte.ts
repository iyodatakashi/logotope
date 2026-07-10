import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type {
	Stakeholder,
	StakeholderForFirestore
} from '$lib/models/stakeholder/stakeholder.types';

export const createStakeholdersStore = (topicId: string) => {
	let stakeholders = $state<Stakeholder[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		unsubscribe = onSnapshot(doc(db, 'topics', topicId, 'stakeholders', '0'), (snap) => {
			const data = snap.exists()
				? (snap.data() as { stakeholders: StakeholderForFirestore[] })
				: null;
			// 永続された安定 id をそのまま採用する（境界でドメイン型へ変換して保持）。
			stakeholders = (data?.stakeholders ?? []).map((stakeholder) => ({ ...stakeholder }));
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
