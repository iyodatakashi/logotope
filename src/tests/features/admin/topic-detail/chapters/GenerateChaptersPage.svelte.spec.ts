import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

let unmount: (() => void) | undefined;
const mount = () => {
	const result = render(GenerateChaptersPage);
	unmount = result.unmount;
	return result;
};

const { goto, spies, state } = vi.hoisted(() => ({
	goto: vi.fn(),
	spies: {
		generateChapters: vi.fn(),
		resetChapters: vi.fn(),
		resetDebate: vi.fn(),
		resetEditing: vi.fn(),
		approveChapters: vi.fn()
	},
	state: {
		phase: 'chapters' as string,
		phaseStatus: 'generated' as string,
		chapters: [] as unknown[],
		chapterAnalysis: null as unknown
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
				get phase() {
					return state.phase;
				},
				get phaseStatus() {
					return state.phaseStatus;
				},
				generateChapters: spies.generateChapters,
				resetChapters: spies.resetChapters,
				resetDebate: spies.resetDebate,
				resetEditing: spies.resetEditing,
				approveChapters: spies.approveChapters
			};
		},
		get chaptersStore() {
			return {
				get chapters() {
					return state.chapters;
				}
			};
		},
		get chapterAnalysisStore() {
			return {
				get data() {
					return state.chapterAnalysis;
				}
			};
		}
	}
}));

import GenerateChaptersPage from '$lib/features/admin/topic-detail/chapters/GenerateChaptersPage.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	state.phase = 'chapters';
	state.phaseStatus = 'generated';
	state.chapters = [];
	state.chapterAnalysis = null;
});

afterEach(() => {
	unmount?.();
	unmount = undefined;
});

describe('GenerateChaptersPage', () => {
	it('未生成では中央に生成ボタンを出し、独立承認ボタンは出さない', async () => {
		state.phaseStatus = 'not_started';

		mount();

		await expect
			.element(page.getByRole('button', { name: 'アジェンダを生成する' }))
			.toBeInTheDocument();
		expect(page.getByRole('button', { name: '承認して次へ進む' }).elements()).toHaveLength(0);
	});

	it('未生成では「次に進む」を不活性にする', async () => {
		state.phaseStatus = 'not_started';

		mount();

		await expect.element(page.getByRole('button', { name: '次に進む' })).toBeDisabled();
	});

	it('生成済みなら「次に進む」で承認して討論画面へ前進する', async () => {
		state.phaseStatus = 'generated';

		mount();

		await page.getByRole('button', { name: '次に進む' }).click();
		expect(spies.approveChapters).toHaveBeenCalledOnce();
		expect(goto).toHaveBeenCalledWith('/admin/topics/t1/debate');
	});

	it('承認が失敗したときは遷移せず操作ペインにエラーを表示する', async () => {
		state.phaseStatus = 'generated';
		spies.approveChapters.mockRejectedValueOnce(new Error('fail'));

		mount();

		await page.getByRole('button', { name: '次に進む' }).click();

		expect(goto).not.toHaveBeenCalled();
		await expect.element(page.getByRole('alert')).toBeInTheDocument();
	});

	it('前に戻るでペルソナ生成画面へ遷移する', async () => {
		mount();

		await page.getByRole('button', { name: '前に戻る' }).click();
		expect(goto).toHaveBeenCalledWith('/admin/topics/t1/personas');
	});

	it('再生成は確認後にサーバ権威の単一操作のみを呼ぶ（下流 reset を呼ばない）', async () => {
		mount();

		await page.getByRole('button', { name: 'アジェンダを再生成する' }).click();
		await page.getByRole('button', { name: '再生成する', exact: true }).click();

		expect(spies.generateChapters).toHaveBeenCalledOnce();
		expect(spies.resetChapters).not.toHaveBeenCalled();
		expect(spies.resetDebate).not.toHaveBeenCalled();
		expect(spies.resetEditing).not.toHaveBeenCalled();
	});

	it('再生成押下直後は旧章立てを即時に隠す（実削除の同期反映を待たない）', async () => {
		state.chapterAnalysis = { issues: [{ id: 'i1', text: '旧論点', source: 'general' }] };
		state.chapters = [{ id: 'c1', title: '旧章', agenda: [] }];
		spies.generateChapters.mockImplementation(() => new Promise<void>(() => {}));

		mount();

		await expect.element(page.getByText('旧論点').first()).toBeInTheDocument();

		await page.getByRole('button', { name: 'アジェンダを再生成する' }).click();
		await page.getByRole('button', { name: '再生成する', exact: true }).click();

		expect(page.getByText('旧論点').elements()).toHaveLength(0);
	});
});
