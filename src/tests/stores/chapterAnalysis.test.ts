import { describe, it, expect, vi } from 'vitest';
import type { ChapterAnalysisDoc } from '$lib/models/chapter/chapter.types';

let snapshotCb: ((snap: unknown) => void) | null = null;

vi.mock('$lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void) => {
		snapshotCb = cb;
		return () => {};
	}),
	doc: vi.fn(),
}));

import { createChapterAnalysisStore } from '$lib/stores/chapterAnalysis.svelte';

const fire = (data: ChapterAnalysisDoc | null) => {
	snapshotCb?.({ exists: () => data !== null, data: () => data });
};

describe('createChapterAnalysisStore', () => {
	it('ドキュメントが存在しない場合 data は null', () => {
		const store = createChapterAnalysisStore('topic1');
		store.start();
		fire(null);
		expect(store.data).toBeNull();
	});

	it('ドキュメントが存在する場合 data に値がセットされる', () => {
		const store = createChapterAnalysisStore('topic1');
		store.start();
		fire({ general: ['切り口A'], persona: ['切り口B'] });
		expect(store.data).toEqual({ general: ['切り口A'], persona: ['切り口B'] });
	});

	it('isLoaded がスナップショット受信前は false', () => {
		const store = createChapterAnalysisStore('topic1');
		expect(store.isLoaded).toBe(false);
	});

	it('isLoaded がスナップショット受信後は true', () => {
		const store = createChapterAnalysisStore('topic1');
		store.start();
		fire(null);
		expect(store.isLoaded).toBe(true);
	});
});
