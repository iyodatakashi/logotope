import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type {
	EditedPostDebateCommentForFirestore,
	EditedPostDebateCommentsForFirestore
} from '$lib/models/editedPostDebateComment/editedPostDebateComment.types';

// editedPostDebateComments/0 を購読し、編集後の討論後コメントを公開する。
// 生の postDebateComments ストアと同型（onSnapshot・isLoaded）。未生成時は空配列。
export const createEditedPostDebateCommentsStore = (topicId: string) => {
	let comments = $state<EditedPostDebateCommentForFirestore[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		unsubscribe = onSnapshot(
			doc(db, 'topics', topicId, 'editedPostDebateComments', '0'),
			(snap) => {
				const data = snap.exists() ? (snap.data() as EditedPostDebateCommentsForFirestore) : null;
				comments = data?.comments ?? [];
				isLoaded = true;
			}
		);
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	return {
		get comments() {
			return comments;
		},
		get isLoaded() {
			return isLoaded;
		},
		start,
		stop
	};
};

export type EditedPostDebateCommentsStore = ReturnType<typeof createEditedPostDebateCommentsStore>;
