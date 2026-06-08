import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DebateProgress from './DebateProgress.svelte';

describe('DebateProgress.svelte', () => {
	it('shows loading state when progress is null', async () => {
		render(DebateProgress, { progress: null });

		await expect.element(page.getByText('進捗を取得中...')).toBeInTheDocument();
	});

	it('shows current step and progress bar', async () => {
		const progress = { status: 'debating' as const, currentStep: 'ペルソナ田中が発言中', completed: 10, total: 40, updatedAt: new Date().toISOString() };
		render(DebateProgress, { progress });

		await expect.element(page.getByText('ペルソナ田中が発言中')).toBeInTheDocument();
		await expect.element(page.getByText('10 / 40')).toBeInTheDocument();
	});

	it('shows status when currentStep is null', async () => {
		const progress = { status: 'debating' as const, currentStep: null, completed: 5, total: 40, updatedAt: new Date().toISOString() };
		render(DebateProgress, { progress });

		await expect.element(page.getByText('debating')).toBeInTheDocument();
	});

	it('shows completed status', async () => {
		const progress = { status: 'completed' as const, currentStep: '討論完了', completed: 40, total: 40, updatedAt: new Date().toISOString() };
		render(DebateProgress, { progress });

		await expect.element(page.getByText('討論完了')).toBeInTheDocument();
	});
});
