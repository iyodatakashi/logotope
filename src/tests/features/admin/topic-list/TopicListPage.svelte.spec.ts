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
					phase: 'personas',
					phaseStatus: 'running'
				},
				{
					id: 't2',
					title: '停止したテーマ',
					phase: 'debate',
					phaseStatus: 'stopped'
				},
				{
					id: 't3',
					title: '公開されたテーマ',
					phase: 'publish',
					phaseStatus: 'not_started',
					published: true
				},
				{
					id: 't4',
					title: '下書きのテーマ',
					phase: 'publish',
					phaseStatus: 'not_started',
					published: false
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
		await expect.element(page.getByText('ペルソナ生成中')).toBeInTheDocument();
	});

	it('停止状態は「討論停止」バッジを表示する', async () => {
		render(TopicListPage);
		await expect.element(page.getByText('停止したテーマ')).toBeInTheDocument();
		await expect.element(page.getByText('討論停止')).toBeInTheDocument();
	});

	it('公開フェーズは published からバッジ（公開中／未公開）を表示する', async () => {
		render(TopicListPage);
		await expect.element(page.getByText('公開中', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('未公開', { exact: true })).toBeInTheDocument();
	});
});
