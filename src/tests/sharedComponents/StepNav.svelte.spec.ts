import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StepNav from '$lib/sharedComponents/StepNav.svelte';

describe('StepNav.svelte', () => {
	it('3フェーズを「ペルソナ準備」1タブに束ねてグループラベルを表示する', async () => {
		render(StepNav, { topicId: 't1', currentPhase: 'personas' });

		await expect.element(page.getByText('事実リサーチ')).toBeInTheDocument();
		await expect.element(page.getByText('ペルソナ準備')).toBeInTheDocument();
		await expect.element(page.getByText('章立て')).toBeInTheDocument();
		await expect.element(page.getByText('討論')).toBeInTheDocument();
		await expect.element(page.getByText('編集')).toBeInTheDocument();
		// 個別フェーズ名はタブに現れない
		expect(page.getByText('ペルソナ生成').elements()).toHaveLength(0);
		expect(page.getByText('取材').elements()).toHaveLength(0);
	});

	it('到達済みグループはリンクとして遷移可能', async () => {
		render(StepNav, { topicId: 't1', currentPhase: 'interviews' });

		await expect
			.element(page.getByRole('link', { name: '事実リサーチ' }))
			.toHaveAttribute('href', '/admin/topics/t1/fact-research');
		// グループが現在フェーズを含むので href は現在フェーズ（interviews）
		await expect
			.element(page.getByRole('link', { name: 'ペルソナ準備' }))
			.toHaveAttribute('href', '/admin/topics/t1/interviews');
	});

	it('未到達グループはリンクにならず無効化表示される', async () => {
		render(StepNav, { topicId: 't1', currentPhase: 'personas' });

		expect(page.getByRole('link', { name: '章立て' }).elements()).toHaveLength(0);
		expect(page.getByRole('link', { name: '討論' }).elements()).toHaveLength(0);
		expect(page.getByRole('link', { name: '編集' }).elements()).toHaveLength(0);
	});

	it('ペルソナ準備グループ内のどの URL でも同一タブがアクティブになる', async () => {
		const { unmount } = render(StepNav, {
			topicId: 't1',
			currentPhase: 'interviews',
			currentPath: '/admin/topics/t1/stakeholders'
		});
		// stakeholders URL でもペルソナ準備タブが選択（aria-current）
		await expect
			.element(page.getByRole('link', { name: 'ペルソナ準備' }))
			.toHaveAttribute('aria-current', 'page');
		unmount();
	});
});
