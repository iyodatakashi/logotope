import { onSnapshot, collection, getDocs } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { EngagementHistoryEntry } from '$lib/models/engagement/engagement.types';

export type EngagementHistoryEntryWithPersona = EngagementHistoryEntry & {
	turnId: string;
	personaId: string;
};

export const buildEngagementsMap = (
	rawDocs: Array<{ personaId: string; history: Record<string, EngagementHistoryEntry> }>
): Map<string, EngagementHistoryEntryWithPersona[]> => {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const result = new Map<string, EngagementHistoryEntryWithPersona[]>();
	for (const { personaId, history } of rawDocs) {
		for (const [turnId, entry] of Object.entries(history)) {
			const list = result.get(turnId) ?? [];
			result.set(turnId, [...list, { ...entry, turnId, personaId }]);
		}
	}
	return result;
};

export const createEngagementStore = (topicId: string, chapterId: string) => {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	let engagementsMap = $state<Map<string, EngagementHistoryEntryWithPersona[]>>(new Map());
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		const ref = collection(db, 'topics', topicId, 'chapters', chapterId, 'engagements');
		unsubscribe = onSnapshot(ref, (snap) => {
			const docs = snap.docs.map((doc) => ({
				personaId: doc.id,
				history: (doc.data().history ?? {}) as Record<string, EngagementHistoryEntry>
			}));
			engagementsMap = buildEngagementsMap(docs);
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	return {
		get chapterId() {
			return chapterId;
		},
		get engagementsMap() {
			return engagementsMap;
		},
		start,
		stop
	};
};

export type EngagementStore = ReturnType<typeof createEngagementStore>;

export const createEngagementsStore = (topicId: string) => {
	let engagements = $state<EngagementStore[]>([]);
	const engagementsMap = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const merged = new Map<string, EngagementHistoryEntryWithPersona[]>();
		for (const store of engagements) {
			for (const [turnId, entries] of store.engagementsMap) {
				const existing = merged.get(turnId) ?? [];
				merged.set(turnId, [...existing, ...entries]);
			}
		}
		return merged;
	});

	const start = () => {
		const chaptersRef = collection(db, 'topics', topicId, 'chapters');
		getDocs(chaptersRef).then((snap) => {
			const stores = snap.docs.map((doc) => {
				const store = createEngagementStore(topicId, doc.id);
				store.start();
				return store;
			});
			engagements = stores;
		});
	};

	const stop = () => {
		engagements.forEach((store) => store.stop());
		engagements = [];
	};

	return {
		get engagements() {
			return engagements;
		},
		get engagementsMap() {
			return engagementsMap;
		},
		start,
		stop
	};
};

export type EngagementsStore = ReturnType<typeof createEngagementsStore>;
