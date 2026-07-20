import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PublishedArticleListItem from '$lib/features/public/article-list/PublishedArticleListItem.svelte';
import type { PublishedTopic } from '$lib/models/published/published-topic/published-topic.types';

const topic: PublishedTopic = {
	id: 'topic-1',
	title: '消費税増税について',
	// ローカル日付で固定（dayjs の出力文字列を安定させる）
	publishedAt: new Date(2026, 6, 6)
};

describe('PublishedArticleListItem.svelte', () => {
	it('タイトルを表示する', async () => {
		render(PublishedArticleListItem, { topic });
		await expect.element(page.getByText('消費税増税について')).toBeInTheDocument();
	});

	it('公開日を「YYYY年M月D日」形式で表示する（先頭ゼロなし）', async () => {
		render(PublishedArticleListItem, { topic });
		await expect.element(page.getByText('2026年7月6日')).toBeInTheDocument();
	});

	it('記事ページ /articles/{id} へのリンクを持つ', async () => {
		render(PublishedArticleListItem, { topic });
		const link = page.getByRole('link');
		await expect.element(link).toHaveAttribute('href', '/articles/topic-1');
	});
});
