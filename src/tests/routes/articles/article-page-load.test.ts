import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/models/published/published-article/published-article', () => ({ fetchPublishedArticle: vi.fn() }));
vi.mock('@sveltejs/kit', () => ({
	error: vi.fn((status: number, body: unknown) => {
		throw Object.assign(new Error(typeof body === 'string' ? body : 'error'), { status, body });
	})
}));

import { fetchPublishedArticle } from '$lib/models/published/published-article/published-article';
import { error } from '@sveltejs/kit';
import { load } from '../../../routes/articles/[topicId]/+page';
import type { PublishedArticle } from '$lib/models/published/published-article/published-article.types';

const runLoad = (topicId: string) =>
	(load as (event: { params: { topicId: string } }) => Promise<{ article: PublishedArticle }>)({
		params: { topicId }
	});

const article: PublishedArticle = {
	id: 't1',
	title: 'T',
	publishedAt: new Date(2026, 0, 1),
	intro: null,
	outro: null,
	chapters: [],
	impressions: []
};

describe('articles/[topicId] +page.ts load', () => {
	beforeEach(() => vi.clearAllMocks());

	it('公開記事は { article } を返す', async () => {
		vi.mocked(fetchPublishedArticle).mockResolvedValue(article);
		expect(await runLoad('t1')).toEqual({ article });
	});

	it('記事なし（null）は 404 に写像する', async () => {
		vi.mocked(fetchPublishedArticle).mockResolvedValue(null);
		await expect(runLoad('t1')).rejects.toMatchObject({ status: 404 });
		expect(error).toHaveBeenCalledWith(404, expect.anything());
	});

	it('取得失敗（throw）は 500 に写像する', async () => {
		vi.mocked(fetchPublishedArticle).mockRejectedValue(new Error('boom'));
		await expect(runLoad('t1')).rejects.toMatchObject({ status: 500 });
		expect(error).toHaveBeenCalledWith(500, expect.anything());
	});
});
