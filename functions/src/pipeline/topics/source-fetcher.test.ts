import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { fetchAndExtractText } from './source-fetcher.js';

const makeResponse = (body: string, ok = true, status = 200) => ({
	ok,
	status,
	text: () => Promise.resolve(body),
});

describe('fetchAndExtractText', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('正常なHTMLからプレーンテキストを返す', async () => {
		mockFetch.mockResolvedValue(makeResponse('<html><body><p>Hello World</p></body></html>'));
		const result = await fetchAndExtractText('https://example.com');
		expect(result).toBe('Hello World');
	});

	it('scriptタグのコンテンツを除去する', async () => {
		mockFetch.mockResolvedValue(makeResponse('<p>本文</p><script>alert("xss")</script>'));
		const result = await fetchAndExtractText('https://example.com');
		expect(result).not.toContain('alert');
		expect(result).toContain('本文');
	});

	it('styleタグのコンテンツを除去する', async () => {
		mockFetch.mockResolvedValue(makeResponse('<p>本文</p><style>.foo { color: red }</style>'));
		const result = await fetchAndExtractText('https://example.com');
		expect(result).not.toContain('color');
		expect(result).toContain('本文');
	});

	it('HTMLタグをすべて除去してテキストのみ残す', async () => {
		mockFetch.mockResolvedValue(makeResponse('<h1>タイトル</h1><p>段落</p>'));
		const result = await fetchAndExtractText('https://example.com');
		expect(result).not.toMatch(/<[^>]+>/);
		expect(result).toContain('タイトル');
		expect(result).toContain('段落');
	});

	it('HTTPエラー時はnullを返す', async () => {
		mockFetch.mockResolvedValue(makeResponse('Not Found', false, 404));
		const result = await fetchAndExtractText('https://example.com');
		expect(result).toBeNull();
	});

	it('fetch例外時はnullを返す', async () => {
		mockFetch.mockRejectedValue(new Error('Network error'));
		const result = await fetchAndExtractText('https://example.com');
		expect(result).toBeNull();
	});

	it('maxCharsでテキストを切り詰める', async () => {
		const longText = 'a'.repeat(20000);
		mockFetch.mockResolvedValue(makeResponse(`<p>${longText}</p>`));
		const result = await fetchAndExtractText('https://example.com', 100);
		expect(result).not.toBeNull();
		expect(result!.length).toBeLessThanOrEqual(100);
	});

	it('デフォルトmaxCharsは10000文字', async () => {
		const longText = 'a'.repeat(20000);
		mockFetch.mockResolvedValue(makeResponse(`<p>${longText}</p>`));
		const result = await fetchAndExtractText('https://example.com');
		expect(result).not.toBeNull();
		expect(result!.length).toBeLessThanOrEqual(10000);
	});

	it('AbortErrorはnullを返す', async () => {
		const abortError = new DOMException('The operation was aborted.', 'AbortError');
		mockFetch.mockRejectedValue(abortError);
		const result = await fetchAndExtractText('https://example.com');
		expect(result).toBeNull();
	});
});
