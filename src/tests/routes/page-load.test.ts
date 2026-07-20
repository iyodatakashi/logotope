import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/models/published/published-topic/published-topics', () => ({ fetchPublishedTopics: vi.fn() }));

import { fetchPublishedTopics } from '$lib/models/published/published-topic/published-topics';
import { load } from '../../routes/+page';
import type { PublishedTopic } from '$lib/models/published/published-topic/published-topic.types';

const runLoad = () => (load as () => Promise<{ topics: PublishedTopic[]; loadError: boolean }>)();

describe('+page.ts load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('取得成功時は topics を渡し loadError=false を返す', async () => {
		const topics: PublishedTopic[] = [{ id: 't1', title: 'タイトル', publishedAt: new Date(2026, 0, 1) }];
		vi.mocked(fetchPublishedTopics).mockResolvedValue(topics);

		const result = await runLoad();

		expect(result).toEqual({ topics, loadError: false });
	});

	it('取得失敗時は throw せず topics=[] と loadError=true を返す', async () => {
		vi.mocked(fetchPublishedTopics).mockRejectedValue(new Error('permission-denied'));

		const result = await runLoad();

		expect(result).toEqual({ topics: [], loadError: true });
	});
});
