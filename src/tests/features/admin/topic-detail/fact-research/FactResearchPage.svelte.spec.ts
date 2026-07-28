import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

let unmount: (() => void) | undefined;
const mount = () => {
	const result = render(FactResearchPage);
	unmount = result.unmount;
	return result;
};

const { goto, spies, state } = vi.hoisted(() => ({
	goto: vi.fn(),
	spies: {
		generateFactResearch: vi.fn(),
		resetStakeholders: vi.fn(),
		resetPersonas: vi.fn(),
		resetChapters: vi.fn(),
		resetDebate: vi.fn(),
		resetEditing: vi.fn(),
		approveFactResearch: vi.fn()
	},
	state: {
		phase: 'fact-research' as string,
		phaseStatus: 'generated' as string,
		factBaseData: null as {
			facts: { statement: string; sources: unknown[] }[];
			generatedAt: unknown;
		} | null
	}
}));

vi.mock('$app/navigation', () => ({ goto }));

vi.mock('$lib/stores/auth.svelte.js', () => ({
	authStore: { logout: vi.fn(), user: { uid: 'test-user' }, isLoggedIn: true }
}));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return {
				id: 't1',
				title: 'テストテーマ',
				get phase() {
					return state.phase;
				},
				get phaseStatus() {
					return state.phaseStatus;
				},
				generateFactResearch: spies.generateFactResearch,
				resetStakeholders: spies.resetStakeholders,
				resetPersonas: spies.resetPersonas,
				resetChapters: spies.resetChapters,
				resetDebate: spies.resetDebate,
				resetEditing: spies.resetEditing,
				approveFactResearch: spies.approveFactResearch
			};
		},
		get factBaseStore() {
			return {
				get data() {
					return state.factBaseData;
				},
				isLoaded: true,
				save: vi.fn()
			};
		}
	}
}));

import FactResearchPage from '$lib/features/admin/topic-detail/fact-research/FactResearchPage.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	state.phase = 'fact-research';
	state.phaseStatus = 'generated';
	state.factBaseData = null;
});

afterEach(() => {
	unmount?.();
	unmount = undefined;
});

describe('FactResearchPage', () => {
	it('未生成では中央に単一の実行ボタンを出し、確認なしで直接調査を開始する', async () => {
		state.phaseStatus = 'not_started';

		mount();

		// 「実行せず承認する」は撤去済み。
		expect(page.getByRole('button', { name: '実行せず承認する' }).elements()).toHaveLength(0);

		await page.getByRole('button', { name: '事実リサーチを実行する' }).click();
		// 確認ダイアログを挟まず直接 generateFactResearch を呼ぶ。
		expect(spies.generateFactResearch).toHaveBeenCalledOnce();
	});

	it('未生成では「次に進む」を不活性にする', async () => {
		state.phaseStatus = 'not_started';

		mount();

		await expect.element(page.getByRole('button', { name: '次に進む' })).toBeDisabled();
	});

	it('生成完了なら結果が空でも「次に進む」で承認して personas へ前進する', async () => {
		state.phaseStatus = 'generated';
		state.factBaseData = { facts: [], generatedAt: {} };

		mount();

		await expect.element(page.getByRole('button', { name: '次に進む' })).not.toBeDisabled();

		await page.getByRole('button', { name: '次に進む' }).click();
		expect(spies.approveFactResearch).toHaveBeenCalledOnce();
		expect(goto).toHaveBeenCalledWith('/admin/topics/t1/personas');
	});

	it('承認が失敗したときは遷移せず操作ペインにエラーを表示する', async () => {
		state.phaseStatus = 'generated';
		spies.approveFactResearch.mockRejectedValueOnce(new Error('fail'));

		mount();

		await page.getByRole('button', { name: '次に進む' }).click();

		expect(goto).not.toHaveBeenCalled();
		await expect.element(page.getByRole('alert')).toBeInTheDocument();
	});

	it('前に戻るでテーマ設定へ遷移する', async () => {
		mount();

		await page.getByRole('button', { name: '前に戻る' }).click();
		expect(goto).toHaveBeenCalledWith('/admin/topics/t1/theme');
	});

	it('再調査は確認後にサーバ権威の単一操作のみを呼ぶ（下流 reset を呼ばない）', async () => {
		mount();

		await page.getByRole('button', { name: '事実リサーチを再実行する' }).click();
		await page.getByRole('button', { name: '再実行する', exact: true }).click();

		expect(spies.generateFactResearch).toHaveBeenCalledOnce();
		expect(spies.resetStakeholders).not.toHaveBeenCalled();
		expect(spies.resetPersonas).not.toHaveBeenCalled();
		expect(spies.resetChapters).not.toHaveBeenCalled();
		expect(spies.resetDebate).not.toHaveBeenCalled();
		expect(spies.resetEditing).not.toHaveBeenCalled();
	});

	it('再調査押下直後は旧事実を即時に隠す（実削除の同期反映を待たない）', async () => {
		state.factBaseData = { facts: [{ statement: '旧事実', sources: [] }], generatedAt: {} };
		// 往復中（サーバがまだ running を書かず、旧事実も実削除前）の状態を模擬。
		spies.generateFactResearch.mockImplementation(() => new Promise<void>(() => {}));

		mount();

		await expect.element(page.getByText('旧事実').first()).toBeInTheDocument();

		await page.getByRole('button', { name: '事実リサーチを再実行する' }).click();
		await page.getByRole('button', { name: '再実行する', exact: true }).click();

		// 実状態はまだ fact-research/generated（旧事実残存）だが、実行中スケルトンで即時に隠れる。
		expect(page.getByText('旧事実').elements()).toHaveLength(0);
	});
});
