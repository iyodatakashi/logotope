import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PublishedArticleListIntro from '$lib/features/public/article-list/PublishedArticleListIntro.svelte';

describe('PublishedArticleListIntro.svelte', () => {
	it('サービス名をページ唯一の見出し（h1）として表示する', async () => {
		render(PublishedArticleListIntro);

		await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('logotope');
		expect(document.querySelectorAll('h1')).toHaveLength(1);
	});

	it('サービスの位置づけを示す説明文を表示する', async () => {
		render(PublishedArticleListIntro);

		await expect.element(page.getByText(/AIペルソナ/)).toBeInTheDocument();
	});

	it('管理（admin）への導線を表示しない', () => {
		render(PublishedArticleListIntro);

		expect(page.getByRole('link', { name: /admin|管理/ }).elements()).toHaveLength(0);
	});

	it('見た目のためだけの修飾タグを使わない', () => {
		render(PublishedArticleListIntro);

		expect(
			document.querySelectorAll(
				'.published-article-list-intro b, .published-article-list-intro i, .published-article-list-intro br'
			)
		).toHaveLength(0);
	});
});
