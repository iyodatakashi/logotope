import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TopicForm from '$lib/features/admin/new-topic-dialog/TopicForm.svelte';

describe('TopicForm.svelte', () => {
	it('renders title input and submit button', async () => {
		render(TopicForm, { onSubmit: vi.fn() });

		await expect.element(page.getByLabelText('タイトル')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'テーマを作成' })).toBeInTheDocument();
	});

	it('詳細説明・参考URLは作成フォームに置かない（テーマ設定フェーズで入力する）', async () => {
		render(TopicForm, { onSubmit: vi.fn() });

		expect(page.getByLabelText('詳細説明').elements()).toHaveLength(0);
		expect(page.getByRole('button', { name: 'URLを追加' }).elements()).toHaveLength(0);
	});
});
