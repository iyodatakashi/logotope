import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '$lib/firebase.js';
import type { ProgressState } from '$lib/types/index.js';

export const createProgressStore = (topicId: string) => {
	let progress = $state<ProgressState | null>(null);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		const ref = doc(db, 'debate_progress', topicId);
		unsubscribe = onSnapshot(ref, (snap) => {
			if (snap.exists()) {
				const data = snap.data() as ProgressState & { debugLog?: string };
				if (data.debugLog) console.log('[debate]', data.debugLog);
				progress = data;
			}
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	return {
		get progress() {
			return progress;
		},
		start,
		stop
	};
};
