import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '$lib/firebase.js';
import type { ProgressState } from '$lib/types/index.js';

export function createProgressStore(topicId: string) {
	let progress = $state<ProgressState | null>(null);
	let unsubscribe: (() => void) | null = null;

	function start() {
		const ref = doc(db, 'debate_progress', topicId);
		unsubscribe = onSnapshot(ref, (snap) => {
			if (snap.exists()) {
				progress = snap.data() as ProgressState;
			}
		});
	}

	function stop() {
		unsubscribe?.();
		unsubscribe = null;
	}

	return {
		get progress() {
			return progress;
		},
		start,
		stop
	};
}
