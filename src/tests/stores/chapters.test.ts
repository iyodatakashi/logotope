import { describe, it, expect, vi } from 'vitest';
import type { ChapterForFirestore } from '$lib/models/chapter/chapter.types';

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

import { createChaptersStore } from '$lib/stores/chapters.svelte';

const makeChapter = (
	overrides: Partial<ChapterForFirestore> & { id?: string } = {}
): ChapterForFirestore & { id: string } => ({
	id: 'ch1',
	chapterIndex: 0,
	title: 'テスト章',
	agenda: [],
	turns: [],
	status: 'pending',
	...overrides
});

const populate = (
	store: ReturnType<typeof createChaptersStore>,
	chapters: (ChapterForFirestore & { id: string })[]
) => {
	store.start();
	snapshotCb?.({
		docs: chapters.map((c) => ({
			id: c.id,
			data: () => c
		}))
	});
};

describe('createChaptersStore', () => {
	it('chapters がスナップショットから ChapterStore 群として更新される', () => {
		const store = createChaptersStore('topic1');
		expect(store.chapters).toHaveLength(0);

		populate(store, [
			makeChapter({ id: 'ch1', chapterIndex: 0 }),
			makeChapter({ id: 'ch2', chapterIndex: 1 })
		]);
		expect(store.chapters).toHaveLength(2);
		expect(store.chapters[0].id).toBe('ch1');
		expect(store.chapters[1].id).toBe('ch2');
	});

	it('isLoaded が start 後のスナップショット受信で true になる', () => {
		const store = createChaptersStore('topic1');
		expect(store.isLoaded).toBe(false);

		populate(store, []);
		expect(store.isLoaded).toBe(true);
	});

	it('turns が全チャプターの turns をチャプター順・配列順にフラット化する', () => {
		const store = createChaptersStore('topic1');
		const fakeTs = {
			toDate: () => new Date()
		} as unknown as import('firebase/firestore').Timestamp;
		const ch1Turns = [
			{ id: 't1', speakerType: 'facilitator' as const, content: '開幕', createdAt: fakeTs },
			{ id: 't2', speakerType: 'persona' as const, content: '発言2', createdAt: fakeTs }
		];
		const ch2Turns = [
			{ id: 't3', speakerType: 'persona' as const, content: '発言3', createdAt: fakeTs }
		];

		populate(store, [
			makeChapter({ id: 'ch1', chapterIndex: 0, turns: ch1Turns }),
			makeChapter({ id: 'ch2', chapterIndex: 1, turns: ch2Turns })
		]);

		const turns = store.turns;
		expect(turns).toHaveLength(3);
		expect(turns.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
	});

	it('currentChapterId が status=running のチャプター id を指す', () => {
		const store = createChaptersStore('topic1');
		populate(store, [
			makeChapter({ id: 'ch1', chapterIndex: 0, status: 'completed' }),
			makeChapter({ id: 'ch2', chapterIndex: 1, status: 'running' })
		]);

		expect(store.currentChapterId).toBe('ch2');
	});

	it('currentChapterId が running なしの場合 null になる', () => {
		const store = createChaptersStore('topic1');
		populate(store, [makeChapter({ id: 'ch1', chapterIndex: 0, status: 'completed' })]);

		expect(store.currentChapterId).toBeNull();
	});

	it('currentChapter が status=running の ChapterStore を返す', () => {
		const store = createChaptersStore('topic1');
		populate(store, [
			makeChapter({ id: 'ch1', chapterIndex: 0, status: 'completed' }),
			makeChapter({ id: 'ch2', chapterIndex: 1, status: 'running' })
		]);

		expect(store.currentChapter).not.toBeNull();
		expect(store.currentChapter?.id).toBe('ch2');
		expect(store.currentChapter?.chapterIndex).toBe(1);
	});

	it('currentChapter が running なしの場合 null を返す', () => {
		const store = createChaptersStore('topic1');
		populate(store, [makeChapter({ id: 'ch1', chapterIndex: 0, status: 'completed' })]);

		expect(store.currentChapter).toBeNull();
	});

	it('stop 後は unsubscribe が呼ばれる', async () => {
		const unsubscribeMock = vi.fn();
		const { onSnapshot } = await import('firebase/firestore');
		vi.mocked(onSnapshot).mockReturnValueOnce(unsubscribeMock);

		const store = createChaptersStore('topic1');
		store.start();
		store.stop();

		expect(unsubscribeMock).toHaveBeenCalled();
	});
});
