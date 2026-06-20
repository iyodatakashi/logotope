import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { ChapterAnalysisDoc } from '$lib/models/chapter/chapter.types';

export const createChapterAnalysisStore = (topicId: string) => {
	let data = $state<ChapterAnalysisDoc | null>(null);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		unsubscribe = onSnapshot(doc(db, 'topics', topicId, 'chapterAnalysis', '0'), (snap) => {
			data = snap.exists() ? (snap.data() as ChapterAnalysisDoc) : null;
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	return {
		get data() {
			return data;
		},
		get isLoaded() {
			return isLoaded;
		},
		start,
		stop
	};
};
