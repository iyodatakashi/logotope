import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { Stakeholder } from '$lib/models/stakeholder/stakeholder.types';

export const createStakeholdersStore = (topicId: string) => {
	let stakeholders = $state<Stakeholder[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		unsubscribe = onSnapshot(doc(db, 'topics', topicId, 'stakeholders', '0'), (snap) => {
			const data = snap.exists() ? (snap.data() as { stakeholders: Stakeholder[] }) : null;
			// 中間生成物として表示するだけ（採用選択は持たない）。永続された安定 id をそのまま保持する。
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
