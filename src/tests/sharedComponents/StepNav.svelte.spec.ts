import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StepNav from '$lib/sharedComponents/StepNav.svelte';

describe('StepNav.svelte', () => {
	it('ペルソナ生成ステップを単一フェーズ personas に対応させてグループラベルを表示する', async () => {
		render(StepNav, { topicId: 't1', currentPhase: 'personas' });

		await expect.element(page.getByText('テーマ設定')).toBeInTheDocument();
		await expect.element(page.getByText('事実リサーチ')).toBeInTheDocument();
		await expect.element(page.getByText('ペルソナ生成')).toBeInTheDocument();
		await expect.element(page.getByText('アジェンダ生成')).toBeInTheDocument();
		await expect.element(page.getByText('討論')).toBeInTheDocument();
		await expect.element(page.getByText('編集')).toBeInTheDocument();
	});

	it('テーマ設定が先頭ステップで、未到達の事実リサーチはリンクにならない', async () => {
		const { unmount } = render(StepNav, { topicId: 't1', currentPhase: 'theme' });

		await expect
			.element(page.getByRole('link', { name: 'テーマ設定' }))
			.toHaveAttribute('href', '/admin/topics/t1/theme');
		expect(page.getByRole('link', { name: '事実リサーチ' }).elements()).toHaveLength(0);
		unmount();
	});

	it('現在フェーズを含むグループの href は現在フェーズを指す', async () => {
		render(StepNav, { topicId: 't1', currentPhase: 'personas' });

		await expect
			.element(page.getByRole('link', { name: 'テーマ設定' }))
			.toHaveAttribute('href', '/admin/topics/t1/theme');
		await expect
			.element(page.getByRole('link', { name: '事実リサーチ' }))
			.toHaveAttribute('href', '/admin/topics/t1/fact-research');
		// グループが現在フェーズ（personas）を含むので href は personas
		await expect
			.element(page.getByRole('link', { name: 'ペルソナ生成' }))
			.toHaveAttribute('href', '/admin/topics/t1/personas');
	});

	it('通過済みグループの href はグループのフェーズを指す', async () => {
		render(StepNav, { topicId: 't1', currentPhase: 'chapters' });

		await expect
			.element(page.getByRole('link', { name: 'ペルソナ生成' }))
			.toHaveAttribute('href', '/admin/topics/t1/personas');
	});

	it('未到達グループはリンクにならず無効化表示される', async () => {
		render(StepNav, { topicId: 't1', currentPhase: 'personas' });

		expect(page.getByRole('link', { name: 'アジェンダ生成' }).elements()).toHaveLength(0);
		expect(page.getByRole('link', { name: '討論' }).elements()).toHaveLength(0);
		expect(page.getByRole('link', { name: '編集' }).elements()).toHaveLength(0);
	});

	it('personas の URL でペルソナ生成ステップがアクティブになる', async () => {
		const { unmount } = render(StepNav, {
			topicId: 't1',
			currentPhase: 'personas',
			currentPath: '/admin/topics/t1/personas'
		});
		await expect
			.element(page.getByRole('link', { name: 'ペルソナ生成' }))
			.toHaveAttribute('aria-current', 'step');
		unmount();
	});
});
