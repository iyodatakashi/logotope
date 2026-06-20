import { onSnapshot, collection, query, orderBy } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { Turn, TurnDoc } from '$lib/models/turn/turn.types';
import type { ChapterDoc, Chapter } from '$lib/models/chapter/chapter.types';

export type { Chapter };

export const createChaptersStore = (topicId: string) => {
	let chapters = $state<Chapter[]>([]);
	let currentChapterId = $state<string | null>(null);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;
	const turns = $derived(chapters.flatMap((c) => c.turns));
	const currentChapter = $derived(chapters.find((c) => c.id === currentChapterId) ?? null);

	const start = () => {
		const q = query(collection(db, 'topics', topicId, 'chapters'), orderBy('chapterIndex'));
		unsubscribe = onSnapshot(q, (snap) => {
			chapters = snap.docs.map((d) => {
				type RawTurn = Omit<TurnDoc, 'createdAt'> & { createdAt: { toDate: () => Date } };
				type RawChapter = Omit<ChapterDoc, 'turns'> & { turns: RawTurn[] };
				const raw = d.data() as RawChapter;
				const turns: Turn[] = raw.turns.map((t) => ({ ...t, createdAt: t.createdAt.toDate() }));
				return { id: d.id, ...raw, turns };
			});
			currentChapterId = chapters.find((c) => c.status === 'running')?.id ?? null;
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
