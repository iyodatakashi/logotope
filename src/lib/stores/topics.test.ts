import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn(),
	collection: vi.fn(() => 'TOPICS_COLLECTION'),
	query: vi.fn((...args: unknown[]) => ({ args })),
	where: vi.fn((...args: unknown[]) => ({ where: args })),
	orderBy: vi.fn(),
	doc: vi.fn(),
	setDoc: vi.fn(),
	deleteDoc: vi.fn(),
	writeBatch: vi.fn(),
	getDocs: vi.fn(),
	Timestamp: { now: vi.fn(() => 'NOW') }
}));

import { onSnapshot, where } from 'firebase/firestore';
import { createPublishedTopicsStore } from './topics.svelte.js';

type FakeDoc = { id: string; data: () => Record<string, unknown> };
const makeSnap = (docs: FakeDoc[]) => ({ docs });

describe('createPublishedTopicsStore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('published のみに絞り込むクエリを購読する', () => {
		const store = createPublishedTopicsStore();
		store.start();

		expect(where).toHaveBeenCalledWith('status', '==', 'published');
		expect(onSnapshot).toHaveBeenCalledOnce();
	});

	it('publishedAt 降順でソートする（欠損時は updatedAt にフォールバック）', () => {
		const store = createPublishedTopicsStore();
		store.start();

		const callback = vi.mocked(onSnapshot).mock.calls[0][1] as (snap: unknown) => void;
		callback(
			makeSnap([
				{
					id: 'old',
					data: () => ({ title: '古い討論', status: 'published', publishedAt: { seconds: 100 }, updatedAt: { seconds: 100 } })
				},
				{
					id: 'new',
					data: () => ({ title: '新しい討論', status: 'published', publishedAt: { seconds: 300 }, updatedAt: { seconds: 300 } })
				},
				{
					id: 'no-published-at',
					data: () => ({ title: '移行データ', status: 'published', updatedAt: { seconds: 200 } })
				}
			])
		);

		expect(store.topics.map((t) => t.id)).toEqual(['new', 'no-published-at', 'old']);
		expect(store.isLoaded).toBe(true);
	});

	it('start前はisLoadedがfalse', () => {
		const store = createPublishedTopicsStore();
		expect(store.isLoaded).toBe(false);
		expect(store.topics).toEqual([]);
	});
});
