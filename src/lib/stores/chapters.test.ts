import { describe, it, expect, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { ChapterStateDoc } from '$lib/models/session/session.types';

let snapshotCb: ((snap: unknown) => void) | null = null;

vi.mock('$lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn((_q: unknown, cb: (snap: unknown) => void) => {
		snapshotCb = cb;
		return () => {};
	}),
	collection: vi.fn(),
	query: vi.fn(),
	orderBy: vi.fn(),
	Timestamp: { now: vi.fn(() => 'NOW') },
}));

import { createChaptersStore } from './chapters.svelte';

const makeChapter = (
	overrides: Partial<ChapterStateDoc> & { id?: string } = {}
): ChapterStateDoc & { id: string } => ({
	id: 'ch1',
	chapterIndex: 0,
	title: 'テスト章',
	focusQuestion: 'テスト？',
	discussionPoints: [],
	turns: [],
	status: 'pending',
	...overrides,
});

const populate = (store: ReturnType<typeof createChaptersStore>, chapters: (ChapterStateDoc & { id: string })[]) => {
	store.start();
	snapshotCb?.({
		docs: chapters.map((c) => ({
			id: c.id,
			data: () => c,
		})),
	});
};

describe('createChaptersStore', () => {
	it('chapters がスナップショットから更新される', () => {
		const store = createChaptersStore('topic1');
		expect(store.chapters).toHaveLength(0);

		populate(store, [makeChapter({ id: 'ch1', chapterIndex: 0 }), makeChapter({ id: 'ch2', chapterIndex: 1 })]);
		expect(store.chapters).toHaveLength(2);
	});

	it('isLoaded が start 後のスナップショット受信で true になる', () => {
		const store = createChaptersStore('topic1');
		expect(store.isLoaded).toBe(false);

		populate(store, []);
		expect(store.isLoaded).toBe(true);
	});

	it('turns が全チャプターの turns を turnIndex 順にフラット化する', () => {
		const store = createChaptersStore('topic1');
		const ch1Turns = [
			{ id: 't1', turnIndex: 0, speakerType: 'facilitator' as const, content: '開幕', createdAt: Timestamp.now() },
			{ id: 't3', turnIndex: 2, speakerType: 'persona' as const, content: '発言3', createdAt: Timestamp.now() },
		];
		const ch2Turns = [
			{ id: 't2', turnIndex: 1, speakerType: 'persona' as const, content: '発言2', createdAt: Timestamp.now() },
		];

		populate(store, [
			makeChapter({ id: 'ch1', chapterIndex: 0, turns: ch1Turns }),
			makeChapter({ id: 'ch2', chapterIndex: 1, turns: ch2Turns }),
		]);

		const turns = store.turns;
		expect(turns).toHaveLength(3);
		expect(turns.map((t) => t.turnIndex)).toEqual([0, 1, 2]);
	});

	it('runningChapter が status=running のチャプターを返す', () => {
		const store = createChaptersStore('topic1');
		populate(store, [
			makeChapter({ id: 'ch1', chapterIndex: 0, status: 'completed' }),
			makeChapter({ id: 'ch2', chapterIndex: 1, status: 'running' }),
		]);

		expect(store.runningChapter).not.toBeNull();
		expect(store.runningChapter?.chapterIndex).toBe(1);
	});

	it('runningChapter が running なしの場合 null を返す', () => {
		const store = createChaptersStore('topic1');
		populate(store, [
			makeChapter({ id: 'ch1', chapterIndex: 0, status: 'completed' }),
		]);

		expect(store.runningChapter).toBeNull();
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
