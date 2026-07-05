import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { EditedIntroClosingForFirestore } from '$lib/models/editedIntroClosing/editedIntroClosing.types';

// editedIntroClosing/0 を購読し、討論全体のイントロ（冒頭）・クロージング（末尾）を公開する。
// 既存の editedChapters ストアと同型（onSnapshot・isLoaded）。片方のみ生成（他方 null）を許容する。
// 将来の公開ページが再利用できるよう stores 配下に置く。
export const createEditedIntroClosingStore = (topicId: string) => {
	let intro = $state<string | null>(null);
	let closing = $state<string | null>(null);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		unsubscribe = onSnapshot(doc(db, 'topics', topicId, 'editedIntroClosing', '0'), (snap) => {
			const data = snap.exists() ? (snap.data() as EditedIntroClosingForFirestore) : null;
			intro = data?.intro ?? null;
			closing = data?.closing ?? null;
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	return {
		get intro() {
			return intro;
		},
		get closing() {
			return closing;
		},
		get isLoaded() {
			return isLoaded;
		},
		start,
		stop
	};
};

export type EditedIntroClosingStore = ReturnType<typeof createEditedIntroClosingStore>;
