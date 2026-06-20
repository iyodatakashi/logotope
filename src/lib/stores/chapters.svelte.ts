import { onSnapshot, collection, query, orderBy } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { ChapterStateDoc, TurnDoc } from '$lib/models/session/session.types';

export type ChapterDoc = ChapterStateDoc & { id: string };

export const createChaptersStore = (topicId: string) => {
	let chapters = $state<ChapterDoc[]>([]);
	let currentChapterId = $state<string | null>(null);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;
	const turns = $derived(chapters.flatMap((c) => c.turns));
	const currentChapter = $derived(chapters.find((c) => c.id === currentChapterId) ?? null);

	const start = () => {
		const q = query(collection(db, 'topics', topicId, 'chapters'), orderBy('chapterIndex'));
		unsubscribe = onSnapshot(q, (snap) => {
			chapters = snap.docs.map((d) => ({ id: d.id, ...(d.data() as ChapterStateDoc) }));
			currentChapterId = chapters.find((c) => c.status === 'running')?.id ?? null;
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	return {
		get chapters() { return chapters; },
		get turns(): TurnDoc[] { return turns; },
		get currentChapterId() { return currentChapterId; },
		get currentChapter(): ChapterDoc | null { return currentChapter; },
		get isLoaded() { return isLoaded; },
		start,
		stop
	};
};

export type ChaptersStore = ReturnType<typeof createChaptersStore>;
