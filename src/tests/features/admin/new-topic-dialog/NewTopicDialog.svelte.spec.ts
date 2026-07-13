import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

const { mockAddTopic, mockGoto } = vi.hoisted(() => ({
	mockAddTopic: vi.fn().mockResolvedValue('t1'),
	mockGoto: vi.fn()
}));

vi.mock('$app/navigation', () => ({ goto: mockGoto }));
vi.mock('$lib/stores/topics.svelte.js', () => ({
	topicsStore: { addTopic: mockAddTopic }
}));

import NewTopicDialog from '$lib/features/admin/new-topic-dialog/NewTopicDialog.svelte';

const open = () => {
	const result = render(NewTopicDialog);
	result.component.open();
	return result;
};

describe('NewTopicDialog.svelte', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAddTopic.mockResolvedValue('t1');
	});

	it('タイトル未入力では作成ボタンが不活性', async () => {
		open();

		await expect.element(page.getByRole('button', { name: 'テーマを作成' })).toBeDisabled();
	});

	it('タイトルを入力して作成するとトピックを作り、テーマ設定フェーズへ遷移する', async () => {
		open();

		await page.getByRole('textbox').fill('新しい題名');
		await page.getByRole('button', { name: 'テーマを作成' }).click();

		expect(mockAddTopic).toHaveBeenCalledWith('新しい題名');
		expect(mockGoto).toHaveBeenCalledWith('/admin/topics/t1');
	});

	it('タイトルが上限を超えるとエラーを表示する', async () => {
		open();

		await page.getByRole('textbox').fill('あ'.repeat(31));

		await expect.element(page.getByRole('alert')).toHaveTextContent('30文字以内で入力してください');
	});
});
