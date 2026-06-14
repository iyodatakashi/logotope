import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
import type { Phase, PhaseLogicalState } from '$lib/utils/phase.js';

const makeProps = (overrides: Record<string, unknown> = {}) => ({
	phase: 1 as Phase,
	logicalState: 'not_started' as PhaseLogicalState,
	title: 'フェーズ1テスト',
	onGenerate: vi.fn(),
	onApprove: vi.fn(),
	onRegenerate: vi.fn(),
	onRetry: vi.fn(),
	...overrides
});

describe('PhasePanel.svelte', () => {
	describe('タイトル表示', () => {
		it('title を表示する', async () => {
			render(PhasePanel, makeProps({ title: 'フェーズ1テスト' }));
			await expect.element(page.getByText('フェーズ1テスト')).toBeInTheDocument();
		});
	});

	describe('not_started 状態', () => {
		it('生成ボタン（generateLabel）のみ表示する', async () => {
			render(PhasePanel, makeProps({ logicalState: 'not_started' }));
			await expect
				.element(page.getByRole('button', { name: '調査を開始する' }))
				.toBeInTheDocument();
		});

		it('実行中インジケータは表示しない', async () => {
			render(PhasePanel, makeProps({ logicalState: 'not_started' }));
			expect(page.getByRole('status').elements()).toHaveLength(0);
		});

		it('generateHint を表示する', async () => {
			render(PhasePanel, makeProps({ logicalState: 'not_started', generateHint: '準備が整ったら開始してください' }));
			await expect.element(page.getByText('準備が整ったら開始してください')).toBeInTheDocument();
		});

		it('生成ボタンクリックで onGenerate を呼ぶ', async () => {
			const onGenerate = vi.fn();
			render(PhasePanel, makeProps({ logicalState: 'not_started', onGenerate }));
			await page.getByRole('button', { name: '調査を開始する' }).click();
			expect(onGenerate).toHaveBeenCalled();
		});
	});

	describe('running 状態（フェーズ1〜4）', () => {
		it('実行中インジケータを表示する', async () => {
			render(PhasePanel, makeProps({ phase: 1, logicalState: 'running' }));
			await expect.element(page.getByRole('status')).toBeInTheDocument();
		});

		it('「やり直す」（回復アクション）を表示し、生成・承認は表示しない', async () => {
			render(PhasePanel, makeProps({ phase: 1, logicalState: 'running' }));
			await expect.element(page.getByRole('button', { name: 'やり直す' })).toBeInTheDocument();
			expect(page.getByRole('button', { name: '調査を開始する' }).elements()).toHaveLength(0);
			expect(page.getByRole('button', { name: '承認して次へ進む' }).elements()).toHaveLength(0);
		});

		it('「やり直す」クリックで onRetry を呼ぶ', async () => {
			const onRetry = vi.fn();
			render(PhasePanel, makeProps({ phase: 1, logicalState: 'running', onRetry }));
			await page.getByRole('button', { name: 'やり直す' }).click();
			expect(onRetry).toHaveBeenCalled();
		});
	});

	describe('running 状態（フェーズ5）', () => {
		const phase5Running = (overrides = {}) =>
			makeProps({ phase: 5, logicalState: 'running', onStop: vi.fn(), onRestart: vi.fn(), ...overrides });

		it('実行中インジケータを表示する', async () => {
			render(PhasePanel, phase5Running());
			await expect.element(page.getByRole('status')).toBeInTheDocument();
		});

		it('停止ボタンを表示する', async () => {
			render(PhasePanel, phase5Running());
			await expect.element(page.getByRole('button', { name: '討論を停止する' })).toBeInTheDocument();
		});

		it('停止ボタンクリックで onStop を呼ぶ', async () => {
			const onStop = vi.fn();
			render(PhasePanel, phase5Running({ onStop }));
			await page.getByRole('button', { name: '討論を停止する' }).click();
			expect(onStop).toHaveBeenCalled();
		});
	});

	describe('stopped 状態（フェーズ5）', () => {
		const phase5Stopped = (overrides = {}) =>
			makeProps({ phase: 5, logicalState: 'stopped', onStop: vi.fn(), onRestart: vi.fn(), ...overrides });

		it('再開ボタン（restartLabel）を表示する', async () => {
			render(PhasePanel, phase5Stopped());
			await expect.element(page.getByRole('button', { name: '討論を再開する' })).toBeInTheDocument();
		});

		it('再生成ボタン（regenerateLabel）を表示する', async () => {
			render(PhasePanel, phase5Stopped());
			await expect.element(page.getByRole('button', { name: '最初からやり直す' })).toBeInTheDocument();
		});

		it('再開ボタンクリックで onRestart を呼ぶ', async () => {
			const onRestart = vi.fn();
			render(PhasePanel, phase5Stopped({ onRestart }));
			await page.getByRole('button', { name: '討論を再開する' }).click();
			expect(onRestart).toHaveBeenCalled();
		});
	});

	describe('stopped 状態（フェーズ1〜4）', () => {
		it('「やり直す」で再実行できる', async () => {
			const onRetry = vi.fn();
			render(PhasePanel, makeProps({ phase: 2, logicalState: 'stopped', onRetry }));
			await page.getByRole('button', { name: 'やり直す' }).click();
			expect(onRetry).toHaveBeenCalled();
		});
	});

	describe('generated 状態（forwardAction あり：フェーズ1〜4）', () => {
		it('承認ボタン（forwardAction.label）を表示する', async () => {
			render(PhasePanel, makeProps({ phase: 1, logicalState: 'generated' }));
			await expect.element(page.getByRole('button', { name: '承認して次へ進む' })).toBeInTheDocument();
		});

		it('再生成ボタン（regenerateLabel）を表示する', async () => {
			render(PhasePanel, makeProps({ phase: 1, logicalState: 'generated' }));
			await expect.element(page.getByRole('button', { name: '再生成する' })).toBeInTheDocument();
		});

		it('承認ボタンクリックで onApprove を呼ぶ', async () => {
			const onApprove = vi.fn();
			render(PhasePanel, makeProps({ phase: 1, logicalState: 'generated', onApprove }));
			await page.getByRole('button', { name: '承認して次へ進む' }).click();
			expect(onApprove).toHaveBeenCalled();
		});
	});

	describe('generated 状態（forwardAction なし：フェーズ5）', () => {
		it('承認ボタンを表示しない', async () => {
			render(PhasePanel, makeProps({ phase: 5, logicalState: 'generated', onStop: vi.fn(), onRestart: vi.fn() }));
			expect(page.getByRole('button', { name: '承認して次へ進む' }).elements()).toHaveLength(0);
		});

		it('再生成ボタン（最初からやり直す）を表示する', async () => {
			render(PhasePanel, makeProps({ phase: 5, logicalState: 'generated', onStop: vi.fn(), onRestart: vi.fn() }));
			await expect.element(page.getByRole('button', { name: '最初からやり直す' })).toBeInTheDocument();
		});
	});

	describe('approved 状態', () => {
		it('再生成ボタンのみ表示する', async () => {
			render(PhasePanel, makeProps({ phase: 1, logicalState: 'approved' }));
			await expect.element(page.getByRole('button', { name: '再生成する' })).toBeInTheDocument();
			expect(page.getByRole('button').elements()).toHaveLength(1);
		});
	});
});
