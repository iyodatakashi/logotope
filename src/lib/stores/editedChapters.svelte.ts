import { onSnapshot, collection, query, orderBy } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type {
	EditedChapter,
	EditedChapterForFirestore,
	EditedChapterDisplayStatus
} from '$lib/models/chapter/chapter.types';

// editedChapters を chapterIndex 順に購読し、章別に編集成果物と表示状態を公開する。
// 編集後ターンは Timestamp を持たない（原本を参照）ため永続形をそのまま実行時形として使う。
// 将来の公開ページが再利用できるよう stores 配下に置く。
export const createEditedChaptersStore = (topicId: string) => {
	let editedChapters = $state<EditedChapter[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		const q = query(collection(db, 'topics', topicId, 'editedChapters'), orderBy('chapterIndex'));
		unsubscribe = onSnapshot(q, (snap) => {
			editedChapters = snap.docs.map((doc) => {
				const raw = doc.data() as EditedChapterForFirestore;
				return { id: doc.id, ...raw };
			});
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	const getEditedChapter = (chapterId: string): EditedChapter | null =>
		editedChapters.find((editedChapter) => editedChapter.id === chapterId) ?? null;

	// 成果物が存在しない章は 'missing'（未実行・実行中）として原本にフォールバックさせる。
	const getDisplayStatus = (chapterId: string): EditedChapterDisplayStatus =>
		editedChapters.find((editedChapter) => editedChapter.id === chapterId)?.status ?? 'missing';

	return {
		get editedChapters() {
			return editedChapters;
		},
		get isLoaded() {
			return isLoaded;
		},
		getEditedChapter,
		getDisplayStatus,
		start,
		stop
	};
};

export type EditedChaptersStore = ReturnType<typeof createEditedChaptersStore>;
