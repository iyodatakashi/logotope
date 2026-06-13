import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
import type { PhaseController } from '$lib/models/topic/phaseController.svelte.js';

const makeCtrl = (overrides: Partial<PhaseController> = {}): PhaseController => ({
	phase: 1,
	logicalState: 'not_started',
	inFlight: false,
	error: null,
	runGenerate: vi.fn().mockResolvedValue(undefined),
	runApprove: vi.fn().mockResolvedValue(undefined),
	runRegenerate: vi.fn().mockResolvedValue(undefined),
	clearError: vi.fn(),
	...overrides
});

const BASE_PROPS = { title: 'フェーズ1テスト', controller: makeCtrl() };

describe('PhasePanel.svelte', () => {
	describe('タイトル表示', () => {
		it('title を表示する', async () => {
			render(PhasePanel, { ...BASE_PROPS, title: 'フェーズ1テスト' });
			await expect.element(page.getByText('フェーズ1テスト')).toBeInTheDocument();
		});
	});

	describe('not_started 状態', () => {
		it('生成ボタン（generateLabel）のみ表示する', async () => {
			render(PhasePanel, { ...BASE_PROPS, controller: makeCtrl({ logicalState: 'not_started' }) });
			await expect
				.element(page.getByRole('button', { name: '調査を開始する' }))
				.toBeInTheDocument();
		});

		it('実行中インジケータは表示しない', async () => {
			render(PhasePanel, { ...BASE_PROPS, controller: makeCtrl({ logicalState: 'not_started' }) });
			expect(page.getByRole('status').elements()).toHaveLength(0);
		});

		it('generateHint を表示する', async () => {
			render(PhasePanel, {
				...BASE_PROPS,
				controller: makeCtrl({ logicalState: 'not_started' }),
				generateHint: '準備が整ったら開始してください'
			});
			await expect
				.element(page.getByText('準備が整ったら開始してください'))
				.toBeInTheDocument();
		});

		it('生成ボタンクリックで runGenerate を呼ぶ', async () => {
			const ctrl = makeCtrl({ logicalState: 'not_started' });
			render(PhasePanel, { ...BASE_PROPS, controller: ctrl });
			await page.getByRole('button', { name: '調査を開始する' }).click();
			expect(ctrl.runGenerate).toHaveBeenCalled();
		});
	});

	describe('running 状態（フェーズ1〜4）', () => {
		it('実行中インジケータを表示する', async () => {
			render(PhasePanel, {
				...BASE_PROPS,
				controller: makeCtrl({ phase: 1, logicalState: 'running' })
			});
			await expect.element(page.getByRole('status')).toBeInTheDocument();
		});

		it('生成・承認・再生成ボタンを表示しない', async () => {
			render(PhasePanel, {
				...BASE_PROPS,
				controller: makeCtrl({ phase: 1, logicalState: 'running' })
			});
			expect(page.getByRole('button').elements()).toHaveLength(0);
		});
	});

	describe('running 状態（フェーズ5）', () => {
		const phase5RunningCtrl = () =>
			makeCtrl({
				phase: 5,
				logicalState: 'running',
				runStop: vi.fn().mockResolvedValue(undefined)
			});

		it('実行中インジケータを表示する', async () => {
			render(PhasePanel, { ...BASE_PROPS, controller: phase5RunningCtrl() });
			await expect.element(page.getByRole('status')).toBeInTheDocument();
		});

		it('停止ボタンを表示する', async () => {
			render(PhasePanel, { ...BASE_PROPS, controller: phase5RunningCtrl() });
			await expect
				.element(page.getByRole('button', { name: '討論を停止する' }))
				.toBeInTheDocument();
		});

		it('停止ボタンクリックで runStop を呼ぶ', async () => {
			const ctrl = phase5RunningCtrl();
			render(PhasePanel, { ...BASE_PROPS, controller: ctrl });
			await page.getByRole('button', { name: '討論を停止する' }).click();
			expect(ctrl.runStop).toHaveBeenCalled();
		});
	});

	describe('stopped 状態（フェーズ5）', () => {
		const phase5StoppedCtrl = () =>
			makeCtrl({
				phase: 5,
				logicalState: 'stopped',
				runStop: vi.fn().mockResolvedValue(undefined),
				runRestart: vi.fn().mockResolvedValue(undefined)
			});

		it('再開ボタン（restartLabel）を表示する', async () => {
			render(PhasePanel, { ...BASE_PROPS, controller: phase5StoppedCtrl() });
			await expect
				.element(page.getByRole('button', { name: '討論を再開する' }))
				.toBeInTheDocument();
		});

		it('再生成ボタン（regenerateLabel）を表示する', async () => {
			render(PhasePanel, { ...BASE_PROPS, controller: phase5StoppedCtrl() });
			await expect
				.element(page.getByRole('button', { name: '最初からやり直す' }))
				.toBeInTheDocument();
		});

		it('再開ボタンクリックで runRestart を呼ぶ', async () => {
			const ctrl = phase5StoppedCtrl();
			render(PhasePanel, { ...BASE_PROPS, controller: ctrl });
			await page.getByRole('button', { name: '討論を再開する' }).click();
			expect(ctrl.runRestart).toHaveBeenCalled();
		});
	});

	describe('generated 状態（forwardAction あり：フェーズ1〜4）', () => {
		it('承認ボタン（forwardAction.label）を表示する', async () => {
			render(PhasePanel, {
				...BASE_PROPS,
				controller: makeCtrl({ phase: 1, logicalState: 'generated' })
			});
			await expect
				.element(page.getByRole('button', { name: '承認して次へ進む' }))
				.toBeInTheDocument();
		});

		it('再生成ボタン（regenerateLabel）を表示する', async () => {
			render(PhasePanel, {
				...BASE_PROPS,
				controller: makeCtrl({ phase: 1, logicalState: 'generated' })
			});
			await expect.element(page.getByRole('button', { name: '再生成する' })).toBeInTheDocument();
		});

		it('承認ボタンクリックで runApprove を呼ぶ', async () => {
			const ctrl = makeCtrl({ phase: 1, logicalState: 'generated' });
			render(PhasePanel, { ...BASE_PROPS, controller: ctrl });
			await page.getByRole('button', { name: '承認して次へ進む' }).click();
			expect(ctrl.runApprove).toHaveBeenCalled();
		});
	});

	describe('generated 状態（forwardAction なし：フェーズ5）', () => {
		it('承認ボタンを表示しない', async () => {
			render(PhasePanel, {
				...BASE_PROPS,
				controller: makeCtrl({ phase: 5, logicalState: 'generated' })
			});
			expect(page.getByRole('button', { name: '承認して次へ進む' }).elements()).toHaveLength(0);
		});

		it('再生成ボタン（最初からやり直す）を表示する', async () => {
			render(PhasePanel, {
				...BASE_PROPS,
				controller: makeCtrl({ phase: 5, logicalState: 'generated' })
			});
			await expect
				.element(page.getByRole('button', { name: '最初からやり直す' }))
				.toBeInTheDocument();
		});
	});

	describe('approved 状態', () => {
		it('再生成ボタンのみ表示する', async () => {
			render(PhasePanel, {
				...BASE_PROPS,
				controller: makeCtrl({ phase: 1, logicalState: 'approved' })
			});
			await expect.element(page.getByRole('button', { name: '再生成する' })).toBeInTheDocument();
			expect(page.getByRole('button').elements()).toHaveLength(1);
		});
	});

	describe('エラー表示', () => {
		it('error が非 null のとき alert を表示する', async () => {
			render(PhasePanel, {
				...BASE_PROPS,
				controller: makeCtrl({ logicalState: 'not_started', error: '生成に失敗しました' })
			});
			await expect
				.element(page.getByRole('alert'))
				.toBeInTheDocument();
			await expect
				.element(page.getByText('エラー: 生成に失敗しました'))
				.toBeInTheDocument();
		});

		it('error が null のとき alert を表示しない', async () => {
			render(PhasePanel, {
				...BASE_PROPS,
				controller: makeCtrl({ logicalState: 'not_started', error: null })
			});
			expect(page.getByRole('alert').elements()).toHaveLength(0);
		});
	});
});
