import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/firebase.js', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
	httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: {} }))
}));
vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'new-id') }));
vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn(),
	collection: vi.fn(),
	query: vi.fn(),
	orderBy: vi.fn(),
	doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
	setDoc: vi.fn().mockResolvedValue(undefined),
	writeBatch: vi.fn(),
	getDocs: vi.fn(),
	Timestamp: { now: vi.fn(() => 'NOW') }
}));

import { setDoc } from 'firebase/firestore';
import { topicsStore } from './topics.svelte';

describe('topicsStore.addTopic (task 3.3)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('新規トピックを (1, not_started) で明示初期化する', async () => {
		await topicsStore.addTopic('新しい題名');
		expect(setDoc).toHaveBeenCalledWith(
			{ path: 'topics/new-id' },
			expect.objectContaining({
				id: 'new-id',
				title: '新しい題名',
				phase: 1,
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
