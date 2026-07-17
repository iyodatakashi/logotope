import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

const { mockSave, mockApproveTheme, mockFetchSourceContents, mockGoto } = vi.hoisted(() => ({
	mockSave: vi.fn(),
	mockApproveTheme: vi.fn(),
	mockFetchSourceContents: vi.fn(),
	mockGoto: vi.fn()
}));

vi.mock('$app/navigation', () => ({ goto: mockGoto }));

let phase = 'theme';
let sourceUrls: string[] = [];
let published = false;

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return {
				id: 't1',
				title: 'テストテーマ',
				description: '背景',
				sourceUrls,
				phase,
				phaseStatus: 'not_started',
				published,
				save: mockSave,
				fetchSourceContents: mockFetchSourceContents,
				approveTheme: mockApproveTheme
			};
		}
	}
}));

import ThemePage from '$lib/features/admin/topic-detail/theme/ThemePage.svelte';

describe('ThemePage.svelte', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		phase = 'theme';
		sourceUrls = [];
		published = false;
	});

	it('テーマ設定中はタイトル・詳細説明・参考URLを編集でき、前進導線（次に進む）を表示する', async () => {
		render(ThemePage);

		await expect.element(page.getByLabelText('タイトル')).toHaveValue('テストテーマ');
		await expect.element(page.getByLabelText('詳細説明')).toHaveValue('背景');
		await expect.element(page.getByRole('button', { name: 'URLを追加' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '次に進む' })).toBeInTheDocument();
	});

	it('先頭ステップのため「前に戻る」を表示しない', async () => {
		render(ThemePage);

		expect(page.getByRole('button', { name: '前に戻る' }).elements()).toHaveLength(0);
	});

	it('「次に進む」でテーマを保存・承認してから事実リサーチ画面へ遷移する', async () => {
		render(ThemePage);

		await page.getByRole('button', { name: '次に進む' }).click();

		expect(mockSave).toHaveBeenCalledOnce();
		expect(mockFetchSourceContents).not.toHaveBeenCalled();
		expect(mockApproveTheme).toHaveBeenCalledOnce();
		expect(mockGoto).toHaveBeenCalledWith('/admin/topics/t1/fact-research');
	});

	it('参考URLがあれば「次に進む」時に本文取得を実行してから前進する', async () => {
		sourceUrls = ['https://example.com'];
		render(ThemePage);

		await page.getByRole('button', { name: '次に進む' }).click();

		expect(mockFetchSourceContents).toHaveBeenCalledOnce();
		expect(mockApproveTheme).toHaveBeenCalledOnce();
	});

	it('承認が失敗したときは遷移せず操作ペインにエラーを表示する', async () => {
		mockApproveTheme.mockRejectedValueOnce(new Error('fail'));
		render(ThemePage);

		await page.getByRole('button', { name: '次に進む' }).click();

		expect(mockGoto).not.toHaveBeenCalled();
		await expect.element(page.getByRole('alert')).toBeInTheDocument();
	});

	it('公開中はコンテンツ変更操作（タイトル・詳細・URL追加）を凍結する（閲覧・遷移は可能）', async () => {
		published = true;
		sourceUrls = ['https://example.com'];
		render(ThemePage);

		await expect.element(page.getByLabelText('タイトル')).toBeDisabled();
		await expect.element(page.getByLabelText('詳細説明')).toBeDisabled();
		await expect.element(page.getByRole('button', { name: 'URLを追加' })).toBeDisabled();
		// 閲覧・前進は可能（次に進むは無効化しない）。
		await expect.element(page.getByLabelText('タイトル')).toHaveValue('テストテーマ');
		await expect.element(page.getByRole('button', { name: '次に進む' })).not.toBeDisabled();
	});

	it('承認済み（approved）でも編集内容を閲覧でき、押下時は承認を再実行せず遷移のみ行う', async () => {
		phase = 'fact-research';
		render(ThemePage);

		await expect.element(page.getByLabelText('タイトル')).toHaveValue('テストテーマ');

		await page.getByRole('button', { name: '次に進む' }).click();
		expect(mockApproveTheme).not.toHaveBeenCalled();
		expect(mockGoto).toHaveBeenCalledWith('/admin/topics/t1/fact-research');
	});
});
