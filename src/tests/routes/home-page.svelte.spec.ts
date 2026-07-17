import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

// クライアント遷移中の loading 分岐は navigating に依存する。テストは非遷移状態に固定し data 駆動の分岐を検証する。
vi.mock('$app/state', () => ({ navigating: { to: null } }));

import Page from '../../routes/+page.svelte';
import type { PublishedTopic } from '$lib/models/published/published-topic.types';

const topics: PublishedTopic[] = [
	{ id: 'topic-1', title: '消費税増税について', publishedAt: new Date(2026, 6, 6) },
	{ id: 'topic-2', title: '女性天皇を認めるべきか', publishedAt: new Date(2026, 5, 1) }
];

describe('公開インデックスページ（+page.svelte）', () => {
	it('公開一覧を各項目のリンク（/articles/{id}）付きで表示する', async () => {
		render(Page, { data: { topics, loadError: false } });
		await expect.element(page.getByText('消費税増税について')).toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: '消費税増税について' }))
			.toHaveAttribute('href', '/articles/topic-1');
	});

	it('0件のときは公開討論が無い旨を表示する', async () => {
		render(Page, { data: { topics: [], loadError: false } });
		await expect.element(page.getByText(/まだありません/)).toBeInTheDocument();
	});

	it('取得失敗のときは失敗した旨を表示する', async () => {
		render(Page, { data: { topics: [], loadError: true } });
		await expect.element(page.getByText(/取得に失敗/)).toBeInTheDocument();
	});

	it('管理（admin）への導線を表示しない', async () => {
		render(Page, { data: { topics, loadError: false } });
		expect(page.getByRole('link', { name: /admin|管理/ }).elements()).toHaveLength(0);
	});
});
