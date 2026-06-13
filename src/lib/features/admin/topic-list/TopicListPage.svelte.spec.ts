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
					title: '新モデルのテーマ',
					phase: 3,
					phaseStatus: 'running',
					status: 'pending'
				},
				{
					id: 't2',
					title: '旧モデルのテーマ',
					phase: undefined,
					phaseStatus: undefined,
					status: 'completed'
				}
			];
		}
	}
}));

import TopicListPage from './TopicListPage.svelte';

describe('TopicListPage.svelte', () => {
	it('新モデルのトピック（phase/phaseStatus）はphaseDisplayLabelでバッジを表示する', async () => {
		render(TopicListPage);
		await expect.element(page.getByText('新モデルのテーマ')).toBeInTheDocument();
		await expect.element(page.getByText('取材中')).toBeInTheDocument();
	});

	it('旧モデルのトピック（statusのみ）はlegacyフォールバックでバッジを表示する', async () => {
		render(TopicListPage);
		await expect.element(page.getByText('旧モデルのテーマ')).toBeInTheDocument();
		await expect.element(page.getByText('討論完了')).toBeInTheDocument();
	});
});
