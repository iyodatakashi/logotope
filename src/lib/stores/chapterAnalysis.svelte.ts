import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '#lib/stores/firebase.ts';
import type { ChapterAnalysis } from '#lib/models/chapter/chapter.types.ts';

export const createChapterAnalysisStore = (topicId: string) => {
	let data = $state<ChapterAnalysis | null>(null);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		unsubscribe = onSnapshot(doc(db, 'topics', topicId, 'chapterAnalysis', '0'), (snap) => {
			data = snap.exists() ? (snap.data() as ChapterAnalysis) : null;
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
