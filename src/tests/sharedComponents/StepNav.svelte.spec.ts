import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StepNav from '$lib/sharedComponents/StepNav.svelte';

describe('StepNav.svelte', () => {
	it('3フェーズを「ペルソナ生成」1ステップに束ねてグループラベルを表示する', async () => {
		render(StepNav, { topicId: 't1', currentPhase: 'personas' });

		await expect.element(page.getByText('テーマ設定')).toBeInTheDocument();
		await expect.element(page.getByText('事実リサーチ')).toBeInTheDocument();
		await expect.element(page.getByText('ペルソナ生成')).toBeInTheDocument();
		await expect.element(page.getByText('アジェンダ生成')).toBeInTheDocument();
		await expect.element(page.getByText('討論')).toBeInTheDocument();
		await expect.element(page.getByText('編集')).toBeInTheDocument();
		// グループに束ねた個別フェーズ名はステップに現れない
		expect(page.getByText('ステークホルダー調査').elements()).toHaveLength(0);
		expect(page.getByText('取材').elements()).toHaveLength(0);
	});

	it('テーマ設定が先頭ステップで、未到達の事実リサーチはリンクにならない', async () => {
		const { unmount } = render(StepNav, { topicId: 't1', currentPhase: 'theme' });

		await expect
			.element(page.getByRole('link', { name: 'テーマ設定' }))
			.toHaveAttribute('href', '/admin/topics/t1/theme');
		expect(page.getByRole('link', { name: '事実リサーチ' }).elements()).toHaveLength(0);
		unmount();
	});

	it('到達済みグループはリンクとして遷移可能', async () => {
		render(StepNav, { topicId: 't1', currentPhase: 'interviews' });

		await expect
			.element(page.getByRole('link', { name: 'テーマ設定' }))
			.toHaveAttribute('href', '/admin/topics/t1/theme');
		await expect
			.element(page.getByRole('link', { name: '事実リサーチ' }))
			.toHaveAttribute('href', '/admin/topics/t1/fact-research');
		// グループが現在フェーズを含むので href は現在フェーズ（interviews）
		await expect
			.element(page.getByRole('link', { name: 'ペルソナ生成' }))
			.toHaveAttribute('href', '/admin/topics/t1/interviews');
	});

	it('通過済みグループの href はグループ先頭フェーズを指す', async () => {
		render(StepNav, { topicId: 't1', currentPhase: 'chapters' });

		await expect
			.element(page.getByRole('link', { name: 'ペルソナ生成' }))
			.toHaveAttribute('href', '/admin/topics/t1/stakeholders');
	});

	it('未到達グループはリンクにならず無効化表示される', async () => {
		render(StepNav, { topicId: 't1', currentPhase: 'personas' });

		expect(page.getByRole('link', { name: 'アジェンダ生成' }).elements()).toHaveLength(0);
		expect(page.getByRole('link', { name: '討論' }).elements()).toHaveLength(0);
		expect(page.getByRole('link', { name: '編集' }).elements()).toHaveLength(0);
	});

	it('ペルソナ生成グループ内のどの URL でも同一ステップがアクティブになる', async () => {
		const { unmount } = render(StepNav, {
			topicId: 't1',
			currentPhase: 'interviews',
			currentPath: '/admin/topics/t1/stakeholders'
		});
		// stakeholders URL でもペルソナ生成ステップが選択（aria-current）
		await expect
			.element(page.getByRole('link', { name: 'ペルソナ生成' }))
			.toHaveAttribute('aria-current', 'step');
		unmount();
	});
});
