import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

// +error.svelte は page.status で 404/500 を出し分ける。status は hoisted モックで切り替える。
const state = vi.hoisted(() => ({ status: 404 }));
vi.mock('$app/state', () => ({ page: state }));

import ErrorPage from '../../../routes/articles/[topicId]/+error.svelte';

describe('articles/[topicId] +error.svelte', () => {
	it('404 は「記事が見つかりません」とインデックス導線を出す', async () => {
		state.status = 404;
		render(ErrorPage);
		await expect.element(page.getByText(/記事が見つかりません/)).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: /記事一覧|一覧へ/ })).toHaveAttribute('href', '/');
	});

	it('404 以外は「取得に失敗しました」を出す', async () => {
		state.status = 500;
		render(ErrorPage);
		await expect.element(page.getByText(/取得に失敗/)).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: /記事一覧|一覧へ/ })).toHaveAttribute('href', '/');
	});
});
