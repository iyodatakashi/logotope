import { describe, it, expect, vi } from 'vitest';
import type { EditedChapterForFirestore } from '$lib/models/editedChapter/editedChapter.types';

let snapshotCb: ((snap: unknown) => void) | null = null;

vi.mock('$lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn((_q: unknown, cb: (snap: unknown) => void) => {
		snapshotCb = cb;
		return () => {};
	}),
	collection: vi.fn(),
	query: vi.fn(),
	orderBy: vi.fn()
}));

import { createEditedChaptersStore } from '$lib/stores/editedChapters.svelte';

const makeEdited = (
	overrides: Partial<EditedChapterForFirestore> & { id?: string } = {}
): EditedChapterForFirestore & { id: string } => ({
	id: 'ch1',
	chapterIndex: 0,
	title: 'テスト章',
	discussionPoints: [],
	turns: [],
	status: 'completed',
	...overrides
});

const populate = (
	store: ReturnType<typeof createEditedChaptersStore>,
	chapters: (EditedChapterForFirestore & { id: string })[]
) => {
	store.start();
	snapshotCb?.({ docs: chapters.map((c) => ({ id: c.id, data: () => c })) });
};

describe('createEditedChaptersStore', () => {
	it('editedChapters がスナップショットから id 付きで更新される', () => {
		const store = createEditedChaptersStore('topic1');
		expect(store.editedChapters).toHaveLength(0);

		populate(store, [makeEdited({ id: 'ch1' }), makeEdited({ id: 'ch2', chapterIndex: 1 })]);
		expect(store.editedChapters).toHaveLength(2);
		expect(store.editedChapters[0].id).toBe('ch1');
		expect(store.editedChapters[1].id).toBe('ch2');
	});

	it('isLoaded が start 後のスナップショット受信で true になる', () => {
		const store = createEditedChaptersStore('topic1');
		expect(store.isLoaded).toBe(false);
		populate(store, []);
		expect(store.isLoaded).toBe(true);
	});

	it('getEditedChapter は該当章を返し、無ければ null', () => {
		const store = createEditedChaptersStore('topic1');
		populate(store, [makeEdited({ id: 'ch1' })]);
		expect(store.getEditedChapter('ch1')?.id).toBe('ch1');
		expect(store.getEditedChapter('nope')).toBeNull();
	});

	it('getDisplayStatus は completed 章を completed とする', () => {
		const store = createEditedChaptersStore('topic1');
		populate(store, [makeEdited({ id: 'ch1', status: 'completed' })]);
		expect(store.getDisplayStatus('ch1')).toBe('completed');
	});

	it('getDisplayStatus は failed 章を failed とする', () => {
		const store = createEditedChaptersStore('topic1');
		populate(store, [makeEdited({ id: 'ch1', status: 'failed', turns: [] })]);
		expect(store.getDisplayStatus('ch1')).toBe('failed');
	});

	it('getDisplayStatus は成果物が存在しない章を missing とする（原本フォールバック）', () => {
		const store = createEditedChaptersStore('topic1');
		populate(store, [makeEdited({ id: 'ch1' })]);
		expect(store.getDisplayStatus('other')).toBe('missing');
	});
});
