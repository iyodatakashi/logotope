import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockGet = vi.fn();
const mockDoc = vi.fn().mockReturnValue({ get: mockGet, update: mockUpdate });

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc })),
	FieldValue: { serverTimestamp: vi.fn(() => 'mock-server-timestamp') },
	Timestamp: { now: vi.fn(() => 'mock-timestamp') }
}));

const mockFetchAndExtractText = vi.fn();
vi.mock('../../pipeline/topics/source-fetcher.js', () => ({
	fetchAndExtractText: (...args: unknown[]) => mockFetchAndExtractText(...args)
}));

vi.mock('firebase-functions/v2/https', () => ({
	onCall: vi.fn((optsOrHandler: unknown, handler?: unknown) => handler ?? optsOrHandler),
	HttpsError: class HttpsError extends Error {
		constructor(
			public code: string,
			message: string
		) {
			super(message);
		}
	}
}));

vi.mock('../../utils/auth.js', () => ({
	requireAuth: vi.fn()
}));

import { fetchSourceContents } from '../../api/source-contents.js';

const makeRequest = (data: unknown) => ({ data, auth: { uid: 'user1' } });

describe('fetchSourceContents', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('topicIdがない場合はinvalid-argumentエラーを投げる', async () => {
		const handler = fetchSourceContents as unknown as (req: unknown) => Promise<unknown>;
		await expect(handler(makeRequest({}))).rejects.toMatchObject({ code: 'invalid-argument' });
	});

	it('トピックが存在しない場合はnot-foundエラーを投げる', async () => {
		mockGet.mockResolvedValue({ exists: false });
		const handler = fetchSourceContents as unknown as (req: unknown) => Promise<unknown>;
		await expect(handler(makeRequest({ topicId: 'topic1' }))).rejects.toMatchObject({
			code: 'not-found'
		});
	});

	it('sourceUrlsがない場合はinvalid-argumentエラーを投げる', async () => {
		mockGet.mockResolvedValue({
			exists: true,
			data: () => ({ title: 'テスト', sourceUrls: undefined })
		});
		const handler = fetchSourceContents as unknown as (req: unknown) => Promise<unknown>;
		await expect(handler(makeRequest({ topicId: 'topic1' }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('URLフェッチ結果をFirestoreに保存して件数を返す', async () => {
		mockGet.mockResolvedValue({
			exists: true,
			data: () => ({
				sourceUrls: ['https://example.com/1', 'https://example.com/2']
			})
		});
		mockFetchAndExtractText
			.mockResolvedValueOnce('コンテンツ1')
			.mockResolvedValueOnce('コンテンツ2');

		const handler = fetchSourceContents as unknown as (req: unknown) => Promise<unknown>;
		const result = (await handler(makeRequest({ topicId: 'topic1' }))) as {
			fetchedCount: number;
			totalCount: number;
		};

		expect(result.fetchedCount).toBe(2);
		expect(result.totalCount).toBe(2);
		expect(mockUpdate).toHaveBeenCalledOnce();
		const updateArg = mockUpdate.mock.calls[0][0];
		expect(updateArg.fetchedSourceContents).toHaveLength(2);
		expect(updateArg.fetchedSourceContents[0].url).toBe('https://example.com/1');
		expect(updateArg.fetchedSourceContents[0].content).toBe('コンテンツ1');
	});

	it('フェッチ失敗したURLをスキップしてsuccessのみ保存する', async () => {
		mockGet.mockResolvedValue({
			exists: true,
			data: () => ({
				sourceUrls: ['https://example.com/ok', 'https://example.com/fail']
			})
		});
		mockFetchAndExtractText.mockResolvedValueOnce('コンテンツ').mockResolvedValueOnce(null);

		const handler = fetchSourceContents as unknown as (req: unknown) => Promise<unknown>;
		const result = (await handler(makeRequest({ topicId: 'topic1' }))) as {
			fetchedCount: number;
			totalCount: number;
		};

		expect(result.fetchedCount).toBe(1);
		expect(result.totalCount).toBe(2);
		const updateArg = mockUpdate.mock.calls[0][0];
		expect(updateArg.fetchedSourceContents).toHaveLength(1);
	});

	it('sourceContentsFetchedAtをFirestoreに保存する', async () => {
		mockGet.mockResolvedValue({
			exists: true,
			data: () => ({ sourceUrls: ['https://example.com'] })
		});
		mockFetchAndExtractText.mockResolvedValue('コンテンツ');

		const handler = fetchSourceContents as unknown as (req: unknown) => Promise<unknown>;
		await handler(makeRequest({ topicId: 'topic1' }));

		const updateArg = mockUpdate.mock.calls[0][0];
		expect(updateArg.sourceContentsFetchedAt).toBe('mock-server-timestamp');
	});
});
