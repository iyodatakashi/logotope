import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractSources, resolveSourceUrls } from '../../search/grounding.js';

describe('extractSources', () => {
	it('groundingChunksをSearchResultに変換する', () => {
		const metadata = {
			groundingChunks: [
				{ web: { uri: 'https://a.com', title: 'Article A' } },
				{ web: { uri: 'https://b.com', title: 'Article B' } }
			],
			webSearchQueries: ['クエリ1', 'クエリ2']
		};
		const sources = extractSources(metadata as never, 'summary');
		expect(sources).toHaveLength(1);
		expect(sources[0].results).toHaveLength(2);
		expect(sources[0].results[0]).toEqual({ title: 'Article A', url: 'https://a.com' });
		expect(sources[0].results[1]).toEqual({ title: 'Article B', url: 'https://b.com' });
	});

	it('URL重複を排除する', () => {
		const metadata = {
			groundingChunks: [
				{ web: { uri: 'https://a.com', title: 'A1' } },
				{ web: { uri: 'https://a.com', title: 'A2' } },
				{ web: { uri: 'https://b.com', title: 'B' } }
			],
			webSearchQueries: []
		};
		const sources = extractSources(metadata as never, 'summary');
		expect(sources[0].results).toHaveLength(2);
		expect(sources[0].results.map((r) => r.url)).toEqual(['https://a.com', 'https://b.com']);
	});

	it('webSearchQueriesをセミコロン結合してqueryに格納する', () => {
		const metadata = {
			groundingChunks: [{ web: { uri: 'https://a.com' } }],
			webSearchQueries: ['クエリA', 'クエリB']
		};
		const sources = extractSources(metadata as never, 'test-summary');
		expect(sources[0].query).toBe('クエリA; クエリB');
		expect(sources[0].summary).toBe('test-summary');
	});

	it('groundingChunksが空のとき空配列を返す', () => {
		const metadata = { groundingChunks: [], webSearchQueries: [] };
		const sources = extractSources(metadata as never, 'summary');
		expect(sources).toEqual([]);
	});
});

// redirect 解決は HEAD のみ（body を読まない）ので response.url だけ持つレスポンスでよい
const makeFetchResponse = (url: string) => ({ url }) as unknown as Response;

describe('resolveSourceUrls', () => {
	beforeEach(() => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => makeFetchResponse(url))
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('空配列を渡すと空配列を返す', async () => {
		const resolved = await resolveSourceUrls([]);
		expect(resolved).toEqual([]);
	});

	it('リダイレクトURLを実URL(フル)に解決し、url・titleともにフルURLにする', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => makeFetchResponse('https://real-article.example/news/1'))
		);
		const resolved = await resolveSourceUrls([
			{
				query: 'q',
				summary: 's',
				results: [{ title: 'example.com', url: 'https://vertexaisearch.example/redirect/xyz' }]
			}
		]);
		expect(resolved[0].results[0].url).toBe('https://real-article.example/news/1');
		expect(resolved[0].results[0].title).toBe('https://real-article.example/news/1');
	});

	it('解決が失敗したURLは元のURLをurl・titleに使う', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network error');
			})
		);
		const resolved = await resolveSourceUrls([
			{
				query: 'q',
				summary: 's',
				results: [{ title: 'example.com', url: 'https://vertexaisearch.example/redirect/xyz' }]
			}
		]);
		expect(resolved[0].results[0].url).toBe('https://vertexaisearch.example/redirect/xyz');
		expect(resolved[0].results[0].title).toBe('https://vertexaisearch.example/redirect/xyz');
	});
});
