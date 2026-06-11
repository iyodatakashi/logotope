import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StepNav from './StepNav.svelte';

describe('StepNav.svelte', () => {
	it('全フェーズのラベルを表示する', async () => {
		render(StepNav, { topicId: 't1', currentPhase: 1 });

		await expect.element(page.getByText('ステークホルダー調査')).toBeInTheDocument();
		await expect.element(page.getByText('ペルソナ生成')).toBeInTheDocument();
		await expect.element(page.getByText('取材')).toBeInTheDocument();
		await expect.element(page.getByText('討論')).toBeInTheDocument();
	});

	it('到達済みフェーズはリンクとして遷移可能', async () => {
		render(StepNav, { topicId: 't1', currentPhase: 3 });

		await expect
			.element(page.getByRole('link', { name: 'ステークホルダー調査' }))
			.toHaveAttribute('href', '/admin/debate/t1/stakeholders');
		await expect
			.element(page.getByRole('link', { name: 'ペルソナ生成' }))
			.toHaveAttribute('href', '/admin/debate/t1/personas');
		await expect
			.element(page.getByRole('link', { name: '取材' }))
			.toHaveAttribute('href', '/admin/debate/t1/interviews');
	});

	it('未到達フェーズはリンクにならず無効化表示される', async () => {
		render(StepNav, { topicId: 't1', currentPhase: 2 });

		expect(page.getByRole('link', { name: '取材' }).elements()).toHaveLength(0);
		expect(page.getByRole('link', { name: '討論' }).elements()).toHaveLength(0);
	});
});
