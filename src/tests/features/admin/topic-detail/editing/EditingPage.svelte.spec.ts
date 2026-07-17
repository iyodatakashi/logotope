import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

let unmount: (() => void) | undefined;
const mount = () => {
	const result = render(EditingPage);
	unmount = result.unmount;
	return result;
};

const emptyNarration = { status: 'pending' as const, draft: null, final: null };

const { spies, state } = vi.hoisted(() => ({
	spies: {
		startEditing: vi.fn(),
		resetEditing: vi.fn(),
		regenerateArticleElement: vi.fn(),
		approveEditing: vi.fn()
	},
	state: {
		// editing フェーズにいる（討論は通過済み＝debateCompleted）。
		phase: 'editing' as string,
		phaseStatus: 'generated' as string
	}
}));

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
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
				startEditing: spies.startEditing,
				resetEditing: spies.resetEditing,
				regenerateArticleElement: spies.regenerateArticleElement,
				approveEditing: spies.approveEditing
			};
		},
		get editedChaptersStore() {
			return {
				getDisplayStatus: () => 'pending',
				getEditedChapter: () => null
			};
		},
		get editorialStore() {
			return {
				intro: emptyNarration,
				outro: emptyNarration,
				impressions: []
			};
		},
		get personasStore() {
			return { personas: [] };
		},
		get chaptersStore() {
			return { chapters: [] };
		}
	}
}));

import EditingPage from '$lib/features/admin/topic-detail/editing/EditingPage.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	state.phase = 'editing';
	state.phaseStatus = 'generated';
});

afterEach(() => {
	unmount?.();
	unmount = undefined;
});

describe('EditingPage', () => {
	it('編集完了で「次に進む」を押すと編集を承認して公開画面へ遷移する', async () => {
		mount();

		await page.getByRole('button', { name: '次に進む' }).click();

		expect(spies.approveEditing).toHaveBeenCalledOnce();
		expect(goto).toHaveBeenCalledWith('/admin/topics/t1/publish');
	});

	it('編集未完了（not_started）では「次に進む」が不活性で承認しない', async () => {
		state.phaseStatus = 'not_started';
		mount();

		await expect.element(page.getByRole('button', { name: '次に進む' })).toBeDisabled();
		expect(spies.approveEditing).not.toHaveBeenCalled();
	});

	it('承認が失敗するとエラーを表示し、公開画面へ遷移しない', async () => {
		spies.approveEditing.mockRejectedValueOnce(new Error('失敗'));
		mount();

		await page.getByRole('button', { name: '次に進む' }).click();

		await expect
			.element(page.getByText('編集の確定に失敗しました。時間をおいて再試行してください。'))
			.toBeInTheDocument();
		expect(goto).not.toHaveBeenCalled();
	});

	it('討論未完了でもゲート文言を出しつつ「前に戻る」から討論画面へ戻れる', async () => {
		// 討論がまだ実行中＝編集の前提未充足。
		state.phase = 'debate';
		state.phaseStatus = 'running';

		mount();

		await expect
			.element(page.getByText('討論が完了すると編集を開始できます。'))
			.toBeInTheDocument();
		// 討論未完了では中央の実行ボタンは出さない。
		expect(page.getByRole('button', { name: '編集を開始する' }).elements()).toHaveLength(0);

		await page.getByRole('button', { name: '前に戻る' }).click();
		expect(goto).toHaveBeenCalledWith('/admin/topics/t1/debate');
	});

	it('討論完了後は中央に実行操作を出し、前に戻るで討論画面へ戻れる', async () => {
		state.phase = 'editing';
		state.phaseStatus = 'not_started';

		mount();

		await expect.element(page.getByRole('button', { name: '編集を開始する' })).toBeInTheDocument();

		await page.getByRole('button', { name: '前に戻る' }).click();
		expect(goto).toHaveBeenCalledWith('/admin/topics/t1/debate');
	});

	it('やり直しは確認後に startEditing のみを呼ぶ（resetEditing を呼ばない）', async () => {
		mount();

		await page.getByRole('button', { name: '編集をやり直す', exact: true }).nth(0).click();
		await page.getByRole('button', { name: '編集をやり直す', exact: true }).nth(1).click();

		expect(spies.startEditing).toHaveBeenCalledOnce();
		expect(spies.resetEditing).not.toHaveBeenCalled();
	});
});
