import { onSnapshot, collection, query, orderBy } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { Turn, TurnForFirestore } from '$lib/models/turn/turn.types';
import type { ChapterForFirestore, Chapter } from '$lib/models/chapter/chapter.types';

export type { Chapter };

export const createChaptersStore = (topicId: string) => {
	let chapters = $state<Chapter[]>([]);
	let currentChapterId = $state<string | null>(null);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;
	const turns = $derived(chapters.flatMap((chapter) => chapter.turns));
	const currentChapter = $derived(
		chapters.find((chapter) => chapter.id === currentChapterId) ?? null
	);

	const start = () => {
		const q = query(collection(db, 'topics', topicId, 'chapters'), orderBy('chapterIndex'));
		unsubscribe = onSnapshot(q, (snap) => {
			chapters = snap.docs.map((doc) => {
				const raw = doc.data() as ChapterForFirestore;
				const turns: Turn[] = raw.turns.map((turn: TurnForFirestore) => ({
					...turn,
					createdAt: turn.createdAt.toDate()
				}));
				return { id: doc.id, ...raw, turns };
			});
			currentChapterId = chapters.find((chapter) => chapter.status === 'running')?.id ?? null;
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
		get turns(): Turn[] {
			return turns;
		},
		get currentChapterId() {
			return currentChapterId;
		},
		get currentChapter(): Chapter | null {
			return currentChapter;
		},
		get isLoaded() {
			return isLoaded;
		},
		start,
		stop
	};
};

export type ChaptersStore = ReturnType<typeof createChaptersStore>;
