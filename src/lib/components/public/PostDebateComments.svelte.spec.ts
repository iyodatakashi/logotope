import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PostDebateComments from './PostDebateComments.svelte';
import type { PublishedComment } from '$lib/types/index.js';

const comments: PublishedComment[] = [
	{
		personaId: 'p-1',
		personaName: '田中太郎',
		personaRole: '中小企業経営者',
		content: '鈴木さんの補助金の話は参考になりました。'
	},
	{
		personaId: 'p-2',
		personaName: '鈴木花子',
		personaRole: '消費者代表',
		content: '田中さんの経営視点はなるほどと思いました。'
	}
];

describe('PostDebateComments.svelte', () => {
	it('セクションタイトルを表示する', async () => {
		render(PostDebateComments, { comments });
		await expect.element(page.getByText('討論を終えて')).toBeInTheDocument();
	});

	it('各ペルソナのコメントを表示する', async () => {
		render(PostDebateComments, { comments });
		await expect.element(page.getByText('鈴木さんの補助金の話は参考になりました。')).toBeInTheDocument();
		await expect.element(page.getByText('田中さんの経営視点はなるほどと思いました。')).toBeInTheDocument();
	});

	it('ペルソナ名と立場ラベルを表示する', async () => {
		render(PostDebateComments, { comments });
		await expect.element(page.getByText('田中太郎')).toBeInTheDocument();
		await expect.element(page.getByText('中小企業経営者')).toBeInTheDocument();
	});
});
