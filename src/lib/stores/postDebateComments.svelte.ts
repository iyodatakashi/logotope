import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { PostDebateCommentDoc, PostDebateCommentsDoc } from '$lib/models/postDebateComment/postDebateComment.types';

export const createPostDebateCommentsStore = (topicId: string) => {
	let comments = $state<PostDebateCommentDoc[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		unsubscribe = onSnapshot(doc(db, 'topics', topicId, 'postDebateComments', '0'), (snap) => {
			const data = snap.exists() ? (snap.data() as PostDebateCommentsDoc) : null;
			comments = data?.comments ?? [];
			isLoaded = true;
		});
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
