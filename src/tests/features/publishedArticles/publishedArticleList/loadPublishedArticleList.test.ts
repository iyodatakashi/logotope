import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#lib/stores/publishedTopics.ts', () => ({ fetchPublishedTopics: vi.fn() }));

import { fetchPublishedTopics } from '#lib/stores/publishedTopics.ts';
import { loadPublishedArticleList } from '#lib/features/publishedArticles/publishedArticleList/loadPublishedArticleList.ts';
import type { PublishedTopic } from '#lib/models/publishedTopic/publishedTopic.types.ts';

describe('loadPublishedArticleList', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('取得成功時は topics を渡し loadError=false を返す', async () => {
		const topics: PublishedTopic[] = [
			{ id: 't1', title: 'タイトル', publishedAt: new Date(2026, 0, 1) }
		];
		vi.mocked(fetchPublishedTopics).mockResolvedValue(topics);

		const result = await loadPublishedArticleList();

		expect(result).toEqual({ topics, loadError: false });
	});

	it('取得失敗時は throw せず topics=[] と loadError=true を返す', async () => {
		vi.mocked(fetchPublishedTopics).mockRejectedValue(new Error('permission-denied'));

		const result = await loadPublishedArticleList();

		expect(result).toEqual({ topics: [], loadError: true });
	});
});
