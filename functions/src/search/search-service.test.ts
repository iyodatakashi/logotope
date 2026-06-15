import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSearch = vi.fn();

vi.mock('@tavily/core', () => ({
	tavily: vi.fn(() => ({ search: mockSearch })),
}));

import { SearchService } from './search-service.js';

describe('SearchService', () => {
	let service: SearchService;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('isAvailable()', () => {
		it('TAVILY_API_KEY が設定されている場合 true を返す', () => {
			process.env.TAVILY_API_KEY = 'test-key';
			service = new SearchService();
			expect(service.isAvailable()).toBe(true);
			delete process.env.TAVILY_API_KEY;
		});

		it('TAVILY_API_KEY が未設定の場合 false を返す', () => {
			delete process.env.TAVILY_API_KEY;
			service = new SearchService();
			expect(service.isAvailable()).toBe(false);
		});
	});

	describe('executeSearch()', () => {
		beforeEach(() => {
			process.env.TAVILY_API_KEY = 'test-key';
			service = new SearchService();
		});

		afterEach(() => {
			delete process.env.TAVILY_API_KEY;
		});

		it('正常応答: 検索結果のコンテンツを連結した文字列を返す', async () => {
			mockSearch.mockResolvedValue({
				query: 'test',
				results: [
					{ title: '記事A', url: 'https://a.com', content: 'コンテンツA', score: 0.9, publishedDate: '2025-01-01' },
					{ title: '記事B', url: 'https://b.com', content: 'コンテンツB', score: 0.8, publishedDate: '2025-01-01' },
				],
				images: [],
				responseTime: 100,
			});

			const result = await service.executeSearch('少子化 統計');
			expect(result.ok).toBe(true);
			expect(result.content).toContain('コンテンツA');
			expect(result.content).toContain('コンテンツB');
		});

		it('空の検索結果: ok: true で空に近いコンテンツを返す', async () => {
			mockSearch.mockResolvedValue({
				query: 'test',
				results: [],
				images: [],
				responseTime: 50,
			});

			const result = await service.executeSearch('存在しないクエリ');
			expect(result.ok).toBe(true);
		});

		it('HTTP エラー（例外）: ok: false を返し例外を投出しない', async () => {
			mockSearch.mockRejectedValue(new Error('HTTP 500 Internal Server Error'));

			const result = await service.executeSearch('エラークエリ');
			expect(result.ok).toBe(false);
			expect(result.error).toBeDefined();
		});

		it('タイムアウト: ok: false を返し例外を投出しない', async () => {
			mockSearch.mockRejectedValue(new Error('Request timeout'));

			const result = await service.executeSearch('タイムアウトクエリ');
			expect(result.ok).toBe(false);
		});

		it('結果数が MAX_RESULTS 以内に制限される', async () => {
			const manyResults = Array.from({ length: 10 }, (_, i) => ({
				title: `記事${i}`,
				url: `https://example${i}.com`,
				content: `コンテンツ${i}`,
				score: 0.9 - i * 0.05,
				publishedDate: '2025-01-01',
			}));
			mockSearch.mockResolvedValue({ query: 'test', results: manyResults, images: [], responseTime: 100 });

			await service.executeSearch('テスト');
			const callArgs = mockSearch.mock.calls[0][1] as { maxResults?: number };
			expect(callArgs?.maxResults).toBeLessThanOrEqual(5);
		});
	});
});
