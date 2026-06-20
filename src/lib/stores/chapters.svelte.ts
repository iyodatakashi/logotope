import { onSnapshot, collection, query, orderBy } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { ChapterStateDoc, TurnDoc } from '$lib/models/session/session.types';

export type ChapterWithId = ChapterStateDoc & { id: string };

export const createChaptersStore = (topicId: string) => {
	let chapters = $state<ChapterWithId[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		const q = query(collection(db, 'topics', topicId, 'chapters'), orderBy('chapterIndex'));
		unsubscribe = onSnapshot(q, (snap) => {
			chapters = snap.docs.map((d) => ({ id: d.id, ...(d.data() as ChapterStateDoc) }));
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	return {
		get chapters() {
			return chapters;
		},
		get turns(): TurnDoc[] {
			return chapters
				.flatMap((c) => c.turns)
				.sort((a, b) => a.turnIndex - b.turnIndex);
		},
		get runningChapter(): ChapterWithId | null {
			return chapters.find((c) => c.status === 'running') ?? null;
		},
		get isLoaded() {
			return isLoaded;
		},
		start,
		stop
	};
};
