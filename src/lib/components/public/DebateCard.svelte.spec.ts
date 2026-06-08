import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DebateCard from './DebateCard.svelte';

const debate = {
	id: 'debate-1',
	topicTitle: '消費税増税について',
	personaCount: 5,
	publishedAt: '2026-06-01T00:00:00.000Z'
};

describe('DebateCard.svelte', () => {
	it('テーマ名を表示する', async () => {
		render(DebateCard, { debate });
		await expect.element(page.getByText('消費税増税について')).toBeInTheDocument();
	});

	it('ペルソナ数を表示する', async () => {
		render(DebateCard, { debate });
		await expect.element(page.getByText(/5/)).toBeInTheDocument();
	});

	it('公開日を表示する', async () => {
		render(DebateCard, { debate });
		await expect.element(page.getByText(/2026/)).toBeInTheDocument();
	});

	it('討論詳細ページへのリンクを持つ', async () => {
		render(DebateCard, { debate });
		const link = page.getByRole('link');
		await expect.element(link).toHaveAttribute('href', '/debate/debate-1');
	});
});
