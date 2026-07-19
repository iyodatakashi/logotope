import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

// クライアント遷移中の loading 分岐は navigating に依存する。非遷移状態に固定して data 駆動の描画を検証する。
vi.mock('$app/state', () => ({ navigating: { to: null } }));

import ArticlePage from '../../../routes/articles/[topicId]/+page.svelte';
import type { PublishedArticle } from '$lib/models/published/published-article.types';

const article: PublishedArticle = {
	id: 'topic-1',
	title: '消費税増税について',
	publishedAt: new Date(2026, 6, 6),
	intro: 'これは導入です。',
	outro: 'これは締めです。',
	chapters: [
		{
			index: 0,
			title: '第一章',
			turns: [
				{ id: 's1', speakerType: 'persona', speakerName: 'Alice', speakerRole: '賛成派', content: '賛成です。', awarenesses: [] }
			]
		}
	],
	impressions: [
		{ personaId: 'p1', speakerName: 'Alice', speakerRole: '賛成派', content: '学びがありました。' }
	]
};

describe('articles/[topicId] +page.svelte', () => {
	it('タイトル・導入・章・締め・所感を描画する', async () => {
		render(ArticlePage, { data: { article } });
		// 章タイトルは目次リンクと本文見出しの双方に出るため、見出し(role=heading)で一意に検証する。
		await expect.element(page.getByRole('heading', { name: '消費税増税について' })).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { name: '第一章' })).toBeInTheDocument();
		await expect.element(page.getByText('これは導入です。')).toBeInTheDocument();
		await expect.element(page.getByText('これは締めです。')).toBeInTheDocument();
		await expect.element(page.getByText('学びがありました。')).toBeInTheDocument();
	});

	it('インデックスへの導線を出す', async () => {
		render(ArticlePage, { data: { article } });
		await expect.element(page.getByRole('link', { name: /記事一覧|一覧へ/ })).toHaveAttribute('href', '/');
	});

	it('管理（admin）への導線を表示しない', async () => {
		render(ArticlePage, { data: { article } });
		expect(page.getByRole('link', { name: /admin|管理/ }).elements()).toHaveLength(0);
	});
});
