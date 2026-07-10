import { onSnapshot, doc, updateDoc } from 'firebase/firestore';
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

	// 採用チェックの ON/OFF を当該ステークホルダーに永続する（リロード後も保持する）。
	const setSelected = async (id: string, selected: boolean): Promise<void> => {
		const next = stakeholders.map((stakeholder) =>
			stakeholder.id === id ? { ...stakeholder, selected } : stakeholder
		);
		await updateDoc(doc(db, 'topics', topicId, 'stakeholders', '0'), { stakeholders: next });
	};

	return {
		get stakeholders() {
			return stakeholders;
		},
		get isLoaded() {
			return isLoaded;
		},
		start,
		stop,
		setSelected
	};
};
