import {
	onSnapshot,
	collection,
	query,
	orderBy,
	doc,
	updateDoc,
	addDoc,
	writeBatch
} from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { Turn, TurnForFirestore } from '$lib/models/turn/turn.types';
import type { ChapterForFirestore, Chapter } from '$lib/models/chapter/chapter.types';

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

	// 章のタイトル・論点（agenda）を当該 chapter 文書へ直接書く。turns や順序には触れない。
	const updateChapter = async (
		chapterId: string,
		patch: { title?: string; agenda?: string[] }
	): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId, 'chapters', chapterId), patch);
	};

	// 末尾に空の章を追加する。chapterIndex は既存数（末尾）に採番する。
	const addChapter = async (): Promise<void> => {
		await addDoc(collection(db, 'topics', topicId, 'chapters'), {
			chapterIndex: chapters.length,
			title: '',
			agenda: [],
			turns: [],
			status: 'pending'
		});
	};

	// 章を削除し、残りの chapterIndex を 0..n-1 に振り直す（削除と再採番を1バッチで原子的に行う）。
	const deleteChapter = async (chapterId: string): Promise<void> => {
		const remaining = chapters.filter((chapter) => chapter.id !== chapterId);
		const batch = writeBatch(db);
		batch.delete(doc(db, 'topics', topicId, 'chapters', chapterId));
		remaining.forEach((chapter, index) => {
			batch.update(doc(db, 'topics', topicId, 'chapters', chapter.id), { chapterIndex: index });
		});
		await batch.commit();
	};

	// 並べ替え結果を chapterIndex（0..n-1）として一括で書く。orderBy('chapterIndex') に反映される。
	const reorderChapters = async (orderedIds: string[]): Promise<void> => {
		const batch = writeBatch(db);
		orderedIds.forEach((id, index) => {
			batch.update(doc(db, 'topics', topicId, 'chapters', id), { chapterIndex: index });
		});
		await batch.commit();
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
		stop,
		updateChapter,
		addChapter,
		deleteChapter,
		reorderChapters
	};
};

export type ChaptersStore = ReturnType<typeof createChaptersStore>;
