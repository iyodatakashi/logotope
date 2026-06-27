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

	it('renders description textarea', async () => {
		render(TopicForm, { onSubmit: vi.fn() });
		await expect.element(page.getByLabelText('詳細説明')).toBeInTheDocument();
	});

	it('renders URL add button', async () => {
		render(TopicForm, { onSubmit: vi.fn() });
		await expect.element(page.getByRole('button', { name: 'URLを追加' })).toBeInTheDocument();
	});
});
