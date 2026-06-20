import { describe, it, expect, vi } from 'vitest';
import type { PostDebateCommentsDoc } from '$lib/models/session/session.types';

let snapshotCb: ((snap: unknown) => void) | null = null;

vi.mock('$lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void) => {
		snapshotCb = cb;
		return () => {};
	}),
	doc: vi.fn(),
}));

import { createPostDebateCommentsStore } from '$lib/stores/postDebateComments.svelte';

const fire = (data: PostDebateCommentsDoc | null) => {
	snapshotCb?.({ exists: () => data !== null, data: () => data });
};

describe('createPostDebateCommentsStore', () => {
	it('ドキュメントが存在しない場合 comments は空配列', () => {
		const store = createPostDebateCommentsStore('topic1');
		store.start();
		fire(null);
		expect(store.comments).toEqual([]);
	});

	it('ドキュメントが存在する場合 comments に値がセットされる', () => {
		const store = createPostDebateCommentsStore('topic1');
		store.start();
		fire({ comments: [{ id: 'c1', personaId: 'p1', content: 'コメント', sortOrder: 1 }] });
		expect(store.comments).toHaveLength(1);
		expect(store.comments[0].personaId).toBe('p1');
	});

	it('isLoaded がスナップショット受信後は true', () => {
		const store = createPostDebateCommentsStore('topic1');
		store.start();
		fire(null);
		expect(store.isLoaded).toBe(true);
	});
});
