import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

const { mockSaveTheme, mockApproveTheme, mockFetchSourceContents, mockGoto } = vi.hoisted(() => ({
	mockSaveTheme: vi.fn(),
	mockApproveTheme: vi.fn(),
	mockFetchSourceContents: vi.fn(),
	mockGoto: vi.fn()
}));

vi.mock('$app/navigation', () => ({ goto: mockGoto }));

let phase = 'theme';
let sourceUrls: string[] | undefined = undefined;

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
				saveTheme: mockSaveTheme,
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
		sourceUrls = undefined;
	});

	it('テーマ設定中はタイトル・詳細説明・参考URLを編集でき、承認導線を表示する', async () => {
		render(ThemePage);

		await expect.element(page.getByLabelText('タイトル')).toHaveValue('テストテーマ');
		await expect.element(page.getByLabelText('詳細説明')).toHaveValue('背景');
		await expect.element(page.getByRole('button', { name: 'URLを追加' })).toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '承認して次へ進む' }))
			.toBeInTheDocument();
	});

	it('承認するとテーマを保存して事実リサーチフェーズへ前進する', async () => {
		render(ThemePage);

		await page.getByRole('button', { name: '承認して次へ進む' }).click();

		expect(mockSaveTheme).toHaveBeenCalledWith({
			title: 'テストテーマ',
			description: '背景',
			sourceUrls: []
		});
		expect(mockFetchSourceContents).not.toHaveBeenCalled();
		expect(mockApproveTheme).toHaveBeenCalledOnce();
		expect(mockGoto).toHaveBeenCalledWith('/admin/topics/t1/fact-research');
	});

	it('参考URLがあれば承認時に本文取得を実行してから前進する', async () => {
		sourceUrls = ['https://example.com'];
		render(ThemePage);

		await page.getByRole('button', { name: '承認して次へ進む' }).click();

		expect(mockFetchSourceContents).toHaveBeenCalledOnce();
		expect(mockApproveTheme).toHaveBeenCalledOnce();
	});

	it('承認済み（approved）では承認導線を表示しない', async () => {
		phase = 'fact-research';
		render(ThemePage);

		await expect.element(page.getByLabelText('タイトル')).toHaveValue('テストテーマ');
		expect(page.getByRole('button', { name: '承認して次へ進む' }).elements()).toHaveLength(0);
	});
});
