import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$lib/stores/auth.svelte.js', () => ({
	authStore: { logout: vi.fn() }
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/stores/topics.svelte.js', () => ({
	topicsStore: {
		get isLoaded() {
			return true;
		},
		get topics() {
			return [
				{
					id: 't1',
					title: '実行中のテーマ',
					phase: 'interviews',
					phaseStatus: 'running'
				},
				{
					id: 't2',
					title: '停止したテーマ',
					phase: 'debate',
					phaseStatus: 'stopped'
				}
			];
		}
	}
}));

import TopicListPage from '$lib/features/admin/topic-list/TopicListPage.svelte';

describe('TopicListPage.svelte', () => {
	it('トピックの (phase, phaseStatus) からバッジを表示する', async () => {
		render(TopicListPage);
		await expect.element(page.getByText('実行中のテーマ')).toBeInTheDocument();
		await expect.element(page.getByText('取材中')).toBeInTheDocument();
	});

	it('停止状態は「討論停止」バッジを表示する', async () => {
		render(TopicListPage);
		await expect.element(page.getByText('停止したテーマ')).toBeInTheDocument();
		await expect.element(page.getByText('討論停止')).toBeInTheDocument();
	});
});
