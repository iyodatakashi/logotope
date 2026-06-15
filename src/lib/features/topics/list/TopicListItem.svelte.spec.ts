import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TopicListItem from '$lib/features/topics/list/TopicListItem.svelte';

const topic = {
	id: 'debate-1',
	title: '消費税増税について',
	phase: 5 as const,
	phaseStatus: 'generated' as const,
	personaCount: 5,
	publishedAt: new Date('2026-06-01T00:00:00.000Z'),
	createdAt: new Date('2026-01-01T00:00:00.000Z'),
	updatedAt: new Date('2026-06-01T00:00:00.000Z')
};

describe('TopicListItem.svelte', () => {
	it('テーマ名を表示する', async () => {
		render(TopicListItem, { topic });
		await expect.element(page.getByText('消費税増税について')).toBeInTheDocument();
	});

	it('ペルソナ数を表示する', async () => {
		render(TopicListItem, { topic });
		await expect.element(page.getByText(/5/)).toBeInTheDocument();
	});

	it('公開日を表示する', async () => {
		render(TopicListItem, { topic });
		await expect.element(page.getByText(/2026/)).toBeInTheDocument();
	});

	it('討論詳細ページへのリンクを持つ', async () => {
		render(TopicListItem, { topic });
		const link = page.getByRole('link');
		await expect.element(link).toHaveAttribute('href', '/debate/debate-1');
	});
});
