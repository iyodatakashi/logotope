import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/firebase.js', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
	httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: {} }))
}));
vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'new-id') }));

const mockBatchDelete = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
const mockWriteBatch = vi.fn(() => ({ delete: mockBatchDelete, commit: mockBatchCommit }));
type AnySnap = { docs: unknown[] };

vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn(),
	collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
	query: vi.fn(),
	orderBy: vi.fn(),
	doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
	setDoc: vi.fn().mockResolvedValue(undefined),
	writeBatch: () => mockWriteBatch(),
	getDocs: vi.fn(),
	Timestamp: { now: vi.fn(() => 'NOW') }
}));

import { setDoc, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { topicsStore } from '$lib/stores/topics.svelte';

describe('topicsStore.addTopic (task 3.3)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('新規トピックを (fact-research, not_started) で明示初期化する', async () => {
		await topicsStore.addTopic('新しい題名');
		expect(setDoc).toHaveBeenCalledWith(
			{ path: 'topics/new-id' },
			expect.objectContaining({
				id: 'new-id',
				title: '新しい題名',
				phase: 'fact-research',
				phaseStatus: 'not_started'
			})
		);
	});

	it('旧 status pending を書き込まない', async () => {
		await topicsStore.addTopic('題名');
		const call = vi.mocked(setDoc).mock.calls.at(-1)?.[1] as Record<string, unknown>;
		expect(call).not.toHaveProperty('status');
	});

	it('descriptionを渡すとFirestoreに保存する', async () => {
		await topicsStore.addTopic('題名', '詳細説明');
		const call = vi.mocked(setDoc).mock.calls.at(-1)?.[1] as Record<string, unknown>;
		expect(call).toHaveProperty('description', '詳細説明');
	});

	it('descriptionが空文字のときFirestoreに保存しない', async () => {
		await topicsStore.addTopic('題名', '');
		const call = vi.mocked(setDoc).mock.calls.at(-1)?.[1] as Record<string, unknown>;
		expect(call).not.toHaveProperty('description');
	});

	it('sourceUrlsを渡すとFirestoreに保存する', async () => {
		await topicsStore.addTopic('題名', '', ['https://example.com']);
		const call = vi.mocked(setDoc).mock.calls.at(-1)?.[1] as Record<string, unknown>;
		expect(call).toHaveProperty('sourceUrls', ['https://example.com']);
	});

	it('sourceUrlsが空配列のときFirestoreに保存しない', async () => {
		await topicsStore.addTopic('題名', '', []);
		const call = vi.mocked(setDoc).mock.calls.at(-1)?.[1] as Record<string, unknown>;
		expect(call).not.toHaveProperty('sourceUrls');
	});

	it('topicIdを返す', async () => {
		const id = await topicsStore.addTopic('題名');
		expect(id).toBe('new-id');
	});
});

describe('topicsStore.fetchSourceContents（UI からの callable 直呼びを store へ移設）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('fetchSourceContents callable を topicId 付きで呼ぶ', async () => {
		const callable = vi.fn().mockResolvedValue({ data: {} });
		vi.mocked(httpsCallable).mockReturnValue(callable as never);
		await topicsStore.fetchSourceContents('topic1');
		expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'fetchSourceContents');
		expect(callable).toHaveBeenCalledWith({ topicId: 'topic1' });
	});
});

describe('topicsStore.deleteTopic - チャプター engagements サブコレクション削除', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockBatchDelete.mockClear();
		mockBatchCommit.mockResolvedValue(undefined);
	});

	it('topics/{topicId}/engagements は getDocs で取得しない', async () => {
		vi.mocked(getDocs).mockImplementation(async (ref) => {
			const path = (ref as unknown as { path: string }).path;
			if (path === 'topics/topic1/chapters')
				return { docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>;
			return { docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>;
		});

		await topicsStore.deleteTopic('topic1');

		const getDocsPaths = vi
			.mocked(getDocs)
			.mock.calls.map((call) => (call[0] as unknown as { path: string }).path);
		expect(getDocsPaths).not.toContain('topics/topic1/engagements');
	});

	it('各チャプターの engagements サブコレクションを getDocs で取得する', async () => {
		vi.mocked(getDocs).mockImplementation(async (ref) => {
			const path = (ref as unknown as { path: string }).path;
			if (path === 'topics/topic1/personas')
				return { docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>;
			if (path === 'topics/topic1/chapters') {
				const snap: AnySnap = {
					docs: [
						{ ref: { path: 'topics/topic1/chapters/ch1' }, id: 'ch1' },
						{ ref: { path: 'topics/topic1/chapters/ch2' }, id: 'ch2' }
					]
				};
				return snap as unknown as Awaited<ReturnType<typeof getDocs>>;
			}
			if (path.includes('/engagements'))
				return { docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>;
			return { docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>;
		});

		await topicsStore.deleteTopic('topic1');

		const getDocsPaths = vi
			.mocked(getDocs)
			.mock.calls.map((call) => (call[0] as unknown as { path: string }).path);
		expect(getDocsPaths).toContain('topics/topic1/chapters/ch1/engagements');
		expect(getDocsPaths).toContain('topics/topic1/chapters/ch2/engagements');
	});

	it('chapter engagements のドキュメントをバッチ削除対象に追加する', async () => {
		const engRef1 = { path: 'topics/topic1/chapters/ch1/engagements/p1' };
		const engRef2 = { path: 'topics/topic1/chapters/ch1/engagements/p2' };

		vi.mocked(getDocs).mockImplementation(async (ref) => {
			const path = (ref as unknown as { path: string }).path;
			if (path === 'topics/topic1/personas')
				return { docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>;
			if (path === 'topics/topic1/chapters') {
				return {
					docs: [{ ref: { path: 'topics/topic1/chapters/ch1' }, id: 'ch1' }]
				} as unknown as Awaited<ReturnType<typeof getDocs>>;
			}
			if (path === 'topics/topic1/chapters/ch1/engagements') {
				return { docs: [{ ref: engRef1 }, { ref: engRef2 }] } as unknown as Awaited<
					ReturnType<typeof getDocs>
				>;
			}
			return { docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>;
		});

		await topicsStore.deleteTopic('topic1');

		const deletedPaths = mockBatchDelete.mock.calls.map(
			(c) => (c[0] as unknown as { path: string }).path
		);
		expect(deletedPaths).toContain(engRef1.path);
		expect(deletedPaths).toContain(engRef2.path);
	});
});
