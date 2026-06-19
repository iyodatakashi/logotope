import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TopicForm from '$lib/features/admin/new-topic/TopicForm.svelte';

describe('TopicForm.svelte', () => {
	it('renders title input and submit button', async () => {
		render(TopicForm, { onSubmit: vi.fn() });

		await expect.element(page.getByLabelText('タイトル')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'テーマを作成' })).toBeInTheDocument();
	});

	it('shows error when title is empty on submit', async () => {
		render(TopicForm, { onSubmit: vi.fn() });

		await page.getByRole('button', { name: 'テーマを作成' }).click();

		await expect.element(page.getByRole('alert')).toBeInTheDocument();
		await expect.element(page.getByText('タイトルを入力してください')).toBeInTheDocument();
	});

	it('shows error when title exceeds 500 characters', async () => {
		const onSubmit = vi.fn();
		render(TopicForm, { onSubmit });

		const longTitle = 'あ'.repeat(501);
		await page.getByLabelText('タイトル').fill(longTitle);
		await page.getByRole('button', { name: 'テーマを作成' }).click();

		await expect.element(page.getByText('500文字以内で入力してください')).toBeInTheDocument();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it('calls onSubmit with title, description, and sourceUrls when valid', async () => {
		const onSubmit = vi.fn();
		render(TopicForm, { onSubmit });

		await page.getByLabelText('タイトル').fill('AIと社会');
		await page.getByRole('button', { name: 'テーマを作成' }).click();

		expect(onSubmit).toHaveBeenCalledWith('AIと社会', '', []);
	});

	it('renders description textarea', async () => {
		render(TopicForm, { onSubmit: vi.fn() });
		await expect.element(page.getByLabelText('詳細説明')).toBeInTheDocument();
	});

	it('shows error when description exceeds 2000 characters', async () => {
		const onSubmit = vi.fn();
		render(TopicForm, { onSubmit });

		await page.getByLabelText('タイトル').fill('テーマ');
		await page.getByLabelText('詳細説明').fill('あ'.repeat(2001));
		await page.getByRole('button', { name: 'テーマを作成' }).click();

		await expect.element(page.getByText('2000文字以内で入力してください')).toBeInTheDocument();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it('calls onSubmit with description when provided', async () => {
		const onSubmit = vi.fn();
		render(TopicForm, { onSubmit });

		await page.getByLabelText('タイトル').fill('AIと社会');
		await page.getByLabelText('詳細説明').fill('詳細なテーマ説明');
		await page.getByRole('button', { name: 'テーマを作成' }).click();

		expect(onSubmit).toHaveBeenCalledWith('AIと社会', '詳細なテーマ説明', []);
	});

	it('renders URL add button', async () => {
		render(TopicForm, { onSubmit: vi.fn() });
		await expect.element(page.getByRole('button', { name: 'URLを追加' })).toBeInTheDocument();
	});

	it('adds a URL input field when URL追加 is clicked', async () => {
		render(TopicForm, { onSubmit: vi.fn() });

		await page.getByRole('button', { name: 'URLを追加' }).click();
		await expect.element(page.getByPlaceholder('https://')).toBeInTheDocument();
	});

	it('shows error for invalid URL format', async () => {
		const onSubmit = vi.fn();
		render(TopicForm, { onSubmit });

		await page.getByRole('button', { name: 'URLを追加' }).click();
		await page.getByPlaceholder('https://').fill('invalid-url');
		await page.getByLabelText('タイトル').fill('テーマ');
		await page.getByRole('button', { name: 'テーマを作成' }).click();

		await expect.element(page.getByText('https:// または http:// で始まるURLを入力してください')).toBeInTheDocument();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it('calls onSubmit with valid URL', async () => {
		const onSubmit = vi.fn();
		render(TopicForm, { onSubmit });

		await page.getByLabelText('タイトル').fill('テーマ');
		await page.getByRole('button', { name: 'URLを追加' }).click();
		await page.getByPlaceholder('https://').fill('https://example.com');
		await page.getByRole('button', { name: 'テーマを作成' }).click();

		expect(onSubmit).toHaveBeenCalledWith('テーマ', '', ['https://example.com']);
	});

	it('does not add more than 5 URL fields', async () => {
		render(TopicForm, { onSubmit: vi.fn() });

		for (let i = 0; i < 5; i++) {
			await page.getByRole('button', { name: 'URLを追加' }).click();
		}

		const inputs = await page.getByPlaceholder('https://').all();
		expect(inputs.length).toBe(5);
		await expect.element(page.getByRole('button', { name: 'URLを追加' })).not.toBeInTheDocument();
	});
});
