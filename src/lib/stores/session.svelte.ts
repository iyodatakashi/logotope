import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '$lib/firebase.js';
import type { SessionDoc } from '$lib/models/session/session.types.js';

export const createSessionStore = (topicId: string) => {
	let session = $state<SessionDoc | null>(null);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		unsubscribe = onSnapshot(doc(db, 'topics', topicId, 'sessions', '0'), (snap) => {
			session = snap.exists() ? (snap.data() as SessionDoc) : null;
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	return {
		get session() {
			return session;
		},
		get isLoaded() {
			return isLoaded;
		},
		start,
		stop
	};
};
