import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#lib/stores/publishedArticle.ts', () => ({ fetchPublishedArticle: vi.fn() }));
vi.mock('@sveltejs/kit', () => ({
	error: vi.fn((status: number, body: unknown) => {
		throw Object.assign(new Error(typeof body === 'string' ? body : 'error'), { status, body });
	})
}));

import { fetchPublishedArticle } from '#lib/stores/publishedArticle.ts';
import { error } from '@sveltejs/kit';
import { loadPublishedArticleDetail } from '#lib/features/publishedArticles/publishedArticleDetail/loadPublishedArticleDetail.ts';
import type { PublishedArticle } from '#lib/models/publishedArticle/publishedArticle.types.ts';

const article: PublishedArticle = {
	id: 't1',
	title: 'T',
	publishedAt: new Date(2026, 0, 1),
	intro: null,
	outro: null,
	personas: new Map(),
	chapters: [],
	impressions: []
};

describe('loadPublishedArticleDetail', () => {
	beforeEach(() => vi.clearAllMocks());

	it('公開記事は { article } を返す', async () => {
		vi.mocked(fetchPublishedArticle).mockResolvedValue(article);
		expect(await loadPublishedArticleDetail('t1')).toEqual({ article });
	});

	it('記事なし（null）は 404 に写像する', async () => {
		vi.mocked(fetchPublishedArticle).mockResolvedValue(null);
		await expect(loadPublishedArticleDetail('t1')).rejects.toMatchObject({ status: 404 });
		expect(error).toHaveBeenCalledWith(404, expect.anything());
	});

	it('取得失敗（throw）は 500 に写像する', async () => {
		vi.mocked(fetchPublishedArticle).mockRejectedValue(new Error('boom'));
		await expect(loadPublishedArticleDetail('t1')).rejects.toMatchObject({ status: 500 });
		expect(error).toHaveBeenCalledWith(500, expect.anything());
	});
});
