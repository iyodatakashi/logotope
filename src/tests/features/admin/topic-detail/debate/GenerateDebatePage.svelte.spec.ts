import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

let unmount: (() => void) | undefined;
const mount = () => {
	const result = render(GenerateDebatePage);
	unmount = result.unmount;
	return result;
};

const { goto, spies, state } = vi.hoisted(() => ({
	goto: vi.fn(),
	spies: {
		startDebate: vi.fn(),
		stopDebate: vi.fn(),
		resetDebate: vi.fn(),
		resetEditing: vi.fn(),
		approveDebate: vi.fn()
	},
	state: {
		phase: 'debate' as string,
		phaseStatus: 'generated' as string,
		chapters: [] as unknown[]
	}
}));

vi.mock('$app/navigation', () => ({ goto }));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return {
				id: 't1',
				get phase() {
					return state.phase;
				},
				get phaseStatus() {
					return state.phaseStatus;
				},
				startDebate: spies.startDebate,
				stopDebate: spies.stopDebate,
				resetDebate: spies.resetDebate,
				resetEditing: spies.resetEditing,
				approveDebate: spies.approveDebate
			};
		},
		get chaptersStore() {
			return {
				get chapters() {
					return state.chapters;
				},
				get currentChapter() {
					return null;
				}
			};
		}
	}
}));

import GenerateDebatePage from '$lib/features/admin/topic-detail/debate/GenerateDebatePage.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	state.phase = 'debate';
	state.phaseStatus = 'generated';
	state.chapters = [];
});

afterEach(() => {
	unmount?.();
	unmount = undefined;
});

describe('GenerateDebatePage', () => {
	it('未生成では中央に開始ボタンを出し、1章モードのチェックボックスは出さない', async () => {
		state.phaseStatus = 'not_started';

		mount();

		await expect.element(page.getByRole('button', { name: '討論を開始する' })).toBeInTheDocument();
		expect(page.getByRole('checkbox', { name: '1章で討論を終了する' }).elements()).toHaveLength(0);
	});

	it('実行中は中央に停止ボタンを出す', async () => {
		state.phaseStatus = 'running';

		mount();

		await expect.element(page.getByRole('button', { name: '討論を停止する' })).toBeInTheDocument();
		await page.getByRole('button', { name: '討論を停止する' }).click();
		expect(spies.stopDebate).toHaveBeenCalledOnce();
	});

	it('停止状態では「最初からやり直す」1つだけを出し「再開する」は出さない', async () => {
		state.phaseStatus = 'stopped';

		mount();

		await expect
			.element(page.getByRole('button', { name: '最初からやり直す', exact: true }).first())
			.toBeInTheDocument();
		expect(page.getByRole('button', { name: '討論を再開する' }).elements()).toHaveLength(0);
	});

	it('生成済みでは独立した「討論を確定して編集へ」ボタンを出さない', async () => {
		state.phaseStatus = 'generated';

		mount();

		expect(page.getByRole('button', { name: '討論を確定して編集へ' }).elements()).toHaveLength(0);
	});

	it('生成済みなら「次に進む」で承認して編集画面へ前進する', async () => {
		state.phaseStatus = 'generated';

		mount();

		await page.getByRole('button', { name: '次に進む' }).click();
		expect(spies.approveDebate).toHaveBeenCalledOnce();
		expect(goto).toHaveBeenCalledWith('/admin/topics/t1/editing');
	});

	it('承認が失敗したときは遷移せず操作ペインにエラーを表示する', async () => {
		state.phaseStatus = 'generated';
		spies.approveDebate.mockRejectedValueOnce(new Error('fail'));

		mount();

		await page.getByRole('button', { name: '次に進む' }).click();

		expect(goto).not.toHaveBeenCalled();
		await expect.element(page.getByRole('alert')).toBeInTheDocument();
	});

	it('未生成では「次に進む」を不活性にする', async () => {
		state.phaseStatus = 'not_started';

		mount();

		await expect.element(page.getByRole('button', { name: '次に進む' })).toBeDisabled();
	});

	it('前に戻るでアジェンダ生成画面へ遷移する', async () => {
		mount();

		await page.getByRole('button', { name: '前に戻る' }).click();
		expect(goto).toHaveBeenCalledWith('/admin/topics/t1/chapters');
	});

	it('やり直しは確認後にサーバ権威の単一操作のみを引数なしで呼ぶ（下流 reset を呼ばない）', async () => {
		state.phaseStatus = 'generated';

		mount();

		await page.getByRole('button', { name: '最初からやり直す', exact: true }).nth(0).click();
		await page.getByRole('button', { name: '最初からやり直す', exact: true }).nth(1).click();

		expect(spies.startDebate).toHaveBeenCalledOnce();
		expect(spies.startDebate).toHaveBeenCalledWith();
		expect(spies.resetDebate).not.toHaveBeenCalled();
		expect(spies.resetEditing).not.toHaveBeenCalled();
	});
});
