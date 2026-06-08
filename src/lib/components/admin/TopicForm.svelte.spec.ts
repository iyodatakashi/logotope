import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TopicForm from './TopicForm.svelte';

describe('TopicForm.svelte', () => {
	it('renders title input and submit button', async () => {
		render(TopicForm, { onSubmit: vi.fn() });

		await expect.element(page.getByRole('textbox')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'テーマを作成' })).toBeInTheDocument();
	});

	it('shows error when title is empty on submit', async () => {
		render(TopicForm, { onSubmit: vi.fn() });

		await page.getByRole('button', { name: 'テーマを作成' }).click();

		await expect.element(page.getByRole('alert')).toBeInTheDocument();
		await expect
			.element(page.getByText('テーマを入力してください'))
			.toBeInTheDocument();
	});

	it('shows error when title exceeds 500 characters', async () => {
		const onSubmit = vi.fn();
		render(TopicForm, { onSubmit });

		const longTitle = 'あ'.repeat(501);
		await page.getByRole('textbox').fill(longTitle);
		await page.getByRole('button', { name: 'テーマを作成' }).click();

		await expect.element(page.getByText('500文字以内で入力してください')).toBeInTheDocument();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it('calls onSubmit with title when valid', async () => {
		const onSubmit = vi.fn();
		render(TopicForm, { onSubmit });

		await page.getByRole('textbox').fill('AIと社会');
		await page.getByRole('button', { name: 'テーマを作成' }).click();

		expect(onSubmit).toHaveBeenCalledWith('AIと社会');
	});
});
