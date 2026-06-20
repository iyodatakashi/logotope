import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
import type { PhaseLogicalState } from '$lib/models/phase/phase.types';

// フェーズ1〜4 相当（承認あり・停止/再開なし）の既定プロップ
const makeProps = (overrides: Record<string, unknown> = {}) => ({
	logicalState: 'not_started' as PhaseLogicalState,
	title: 'フェーズ1テスト',
	generateLabel: '調査を開始する',
	approveLabel: '承認して次へ進む',
	regenerateLabel: '再生成する',
	regenerateConfirm: {
		title: '再生成しますか？',
		description: 'データが消えます',
		submitLabel: '再生成する'
	},
	onGenerate: vi.fn(),
	onApprove: vi.fn(),
	onRegenerate: vi.fn(),
	...overrides
});

// フェーズ5 相当（承認なし・停止/再開あり）の既定プロップ
const makePhase5Props = (overrides: Record<string, unknown> = {}) => ({
	logicalState: 'running' as PhaseLogicalState,
	title: 'フェーズ5テスト',
	generateLabel: '討論を開始する',
	regenerateLabel: '最初からやり直す',
	regenerateConfirm: {
		title: 'やり直しますか？',
		description: '討論が消えます',
		submitLabel: '最初からやり直す'
	},
	stopLabel: '討論を停止する',
	restartLabel: '討論を再開する',
	onGenerate: vi.fn(),
	onRegenerate: vi.fn(),
	onStop: vi.fn(),
	onRestart: vi.fn(),
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
			render(
				PhasePanel,
				makeProps({ logicalState: 'not_started', generateHint: '準備が整ったら開始してください' })
			);
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
			render(PhasePanel, makeProps({ logicalState: 'running' }));
			await expect.element(page.getByRole('status')).toBeInTheDocument();
		});

		it('回復用に再生成ボタンを表示し、生成・承認は表示しない', async () => {
			render(PhasePanel, makeProps({ logicalState: 'running' }));
			await expect.element(page.getByRole('button', { name: '再生成する' })).toBeInTheDocument();
			expect(page.getByRole('button', { name: '調査を開始する' }).elements()).toHaveLength(0);
			expect(page.getByRole('button', { name: '承認して次へ進む' }).elements()).toHaveLength(0);
		});
	});

	describe('running 状態（フェーズ5）', () => {
		it('実行中インジケータを表示する', async () => {
			render(PhasePanel, makePhase5Props({ logicalState: 'running' }));
			await expect.element(page.getByRole('status')).toBeInTheDocument();
		});

		it('停止ボタンを表示する', async () => {
			render(PhasePanel, makePhase5Props({ logicalState: 'running' }));
			await expect
				.element(page.getByRole('button', { name: '討論を停止する' }))
				.toBeInTheDocument();
		});

		it('停止ボタンクリックで onStop を呼ぶ', async () => {
			const onStop = vi.fn();
			render(PhasePanel, makePhase5Props({ logicalState: 'running', onStop }));
			await page.getByRole('button', { name: '討論を停止する' }).click();
			expect(onStop).toHaveBeenCalled();
		});
	});

	describe('stopped 状態（フェーズ5）', () => {
		it('再開ボタン（restartLabel）を表示する', async () => {
			render(PhasePanel, makePhase5Props({ logicalState: 'stopped' }));
			await expect
				.element(page.getByRole('button', { name: '討論を再開する' }))
				.toBeInTheDocument();
		});

		it('再生成ボタン（regenerateLabel）を表示する', async () => {
			render(PhasePanel, makePhase5Props({ logicalState: 'stopped' }));
			await expect
				.element(page.getByRole('button', { name: '最初からやり直す' }))
				.toBeInTheDocument();
		});

		it('再開ボタンクリックで onRestart を呼ぶ', async () => {
			const onRestart = vi.fn();
			render(PhasePanel, makePhase5Props({ logicalState: 'stopped', onRestart }));
			await page.getByRole('button', { name: '討論を再開する' }).click();
			expect(onRestart).toHaveBeenCalled();
		});
	});

	describe('stopped 状態（フェーズ1〜4）', () => {
		it('再生成ボタンを表示する（確認付きで回復）', async () => {
			render(PhasePanel, makeProps({ logicalState: 'stopped' }));
			await expect.element(page.getByRole('button', { name: '再生成する' })).toBeInTheDocument();
		});
	});

	describe('generated 状態（承認あり：フェーズ1〜4）', () => {
		it('承認ボタン（approveLabel）を表示する', async () => {
			render(PhasePanel, makeProps({ logicalState: 'generated' }));
			await expect
				.element(page.getByRole('button', { name: '承認して次へ進む' }))
				.toBeInTheDocument();
		});

		it('再生成ボタン（regenerateLabel）を表示する', async () => {
			render(PhasePanel, makeProps({ logicalState: 'generated' }));
			await expect.element(page.getByRole('button', { name: '再生成する' })).toBeInTheDocument();
		});

		it('承認ボタンクリックで onApprove を呼ぶ', async () => {
			const onApprove = vi.fn();
			render(PhasePanel, makeProps({ logicalState: 'generated', onApprove }));
			await page.getByRole('button', { name: '承認して次へ進む' }).click();
			expect(onApprove).toHaveBeenCalled();
		});
	});

	describe('generated 状態（承認なし：フェーズ5）', () => {
		it('承認ボタンを表示しない', async () => {
			render(PhasePanel, makePhase5Props({ logicalState: 'generated' }));
			expect(page.getByRole('button', { name: '承認して次へ進む' }).elements()).toHaveLength(0);
		});

		it('再生成ボタン（最初からやり直す）を表示する', async () => {
			render(PhasePanel, makePhase5Props({ logicalState: 'generated' }));
			await expect
				.element(page.getByRole('button', { name: '最初からやり直す' }))
				.toBeInTheDocument();
		});
	});

	describe('approved 状態', () => {
		it('再生成ボタンのみ表示する', async () => {
			render(PhasePanel, makeProps({ logicalState: 'approved' }));
			await expect.element(page.getByRole('button', { name: '再生成する' })).toBeInTheDocument();
			expect(page.getByRole('button').elements()).toHaveLength(1);
		});
	});
});
