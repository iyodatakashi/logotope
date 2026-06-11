import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn().mockResolvedValue(undefined) }));

import { goto } from '$app/navigation';
import PhaseResetPanel from './PhaseResetPanel.svelte';

describe('PhaseResetPanel.svelte', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('「このフェーズからやり直す」ボタンを表示する', async () => {
		render(PhaseResetPanel, {
			phase: 2,
			topicId: 't1',
			discardSummary: ['取材記録'],
			onReset: vi.fn()
		});

		await expect
			.element(page.getByRole('button', { name: 'このフェーズからやり直す' }))
			.toBeInTheDocument();
	});

	it('ボタン押下で破棄対象を列挙した確認ダイアログを表示する', async () => {
		render(PhaseResetPanel, {
			phase: 2,
			topicId: 't1',
			discardSummary: ['ペルソナの取材記録', '討論セッション'],
			onReset: vi.fn()
		});

		await page.getByRole('button', { name: 'このフェーズからやり直す' }).click();

		await expect.element(page.getByText(/ペルソナの取材記録/)).toBeInTheDocument();
		await expect.element(page.getByText(/討論セッション/)).toBeInTheDocument();
	});

	it('キャンセルではonResetを呼ばず遷移もしない', async () => {
		const onReset = vi.fn();
		render(PhaseResetPanel, {
			phase: 2,
			topicId: 't1',
			discardSummary: ['取材記録'],
			onReset
		});

		await page.getByRole('button', { name: 'このフェーズからやり直す' }).click();
		await page.getByRole('button', { name: 'キャンセル' }).click();

		expect(onReset).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();
	});

	it('承諾でonResetを実行し、完了後に該当フェーズへ遷移する', async () => {
		const onReset = vi.fn().mockResolvedValue(undefined);
		render(PhaseResetPanel, {
			phase: 2,
			topicId: 't1',
			discardSummary: ['取材記録'],
			onReset
		});

		await page.getByRole('button', { name: 'このフェーズからやり直す' }).click();
		await page.getByRole('button', { name: 'やり直す', exact: true }).click();

		await vi.waitFor(() => {
			expect(onReset).toHaveBeenCalledOnce();
			expect(goto).toHaveBeenCalledWith('/admin/debate/t1/personas');
		});
	});

	it('onReset失敗時はエラーを表示し遷移しない', async () => {
		const onReset = vi.fn().mockRejectedValue(new Error('リセット失敗'));
		render(PhaseResetPanel, {
			phase: 1,
			topicId: 't1',
			discardSummary: ['取材記録'],
			onReset
		});

		await page.getByRole('button', { name: 'このフェーズからやり直す' }).click();
		await page.getByRole('button', { name: 'やり直す', exact: true }).click();

		await expect.element(page.getByRole('alert')).toBeInTheDocument();
		expect(goto).not.toHaveBeenCalled();
	});
});
