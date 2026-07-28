import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';

import PublishedTurnItem from '$lib/features/public/article-detail/PublishedTurnItem.svelte';
import type { PublishedTurn } from '$lib/models/published/published-article/published-article.types';
import type { PersonaForDisplay } from '$lib/models/persona/persona.types';

// 話者名/肩書は turn に畳まず、personaId 参照＋personas Map で描画時に解決する。
const personas = new Map<string, PersonaForDisplay>([
	['p1', { id: 'p1', topicId: 't1', name: 'Alice', role: '賛成派' }],
	['p2', { id: 'p2', topicId: 't1', name: 'Bob', role: '反対派' }]
]);

const base: PublishedTurn = {
	id: 's1',
	personaId: 'p1',
	content: '賛成です。',
	awarenesses: []
};

const withAwarenesses: PublishedTurn = {
	...base,
	awarenesses: [
		{ personaId: 'p1', content: '気づきの内容A' },
		{ personaId: 'p2', content: '気づきの内容B' }
	]
};

describe('PublishedTurnItem', () => {
	it('気づき0件のときアフォーダンスを出さない（Req 3.2, 3.4）', async () => {
		render(PublishedTurnItem, { turn: base, personas });
		await expect.element(page.getByText('賛成です。')).toBeInTheDocument();
		expect(page.getByRole('button').elements()).toHaveLength(0);
	});

	it('気づき1件以上で件数付きアフォーダンスを出し、本文に気づきを展開しない（Req 3.1, 3.2）', async () => {
		render(PublishedTurnItem, { turn: withAwarenesses, personas });
		await expect.element(page.getByRole('button', { name: /気づき.*2.*件/ })).toBeInTheDocument();
		const body = document.querySelector('.post-item__content');
		expect(body?.textContent).toBe('賛成です。');
		expect(body?.textContent).not.toContain('気づきの内容');
	});

	it('アフォーダンス操作でダイアログが開き「ペルソナ名: 内容」を一覧表示する（Req 3.3, 3.5）', async () => {
		render(PublishedTurnItem, { turn: withAwarenesses, personas });
		await page.getByRole('button', { name: /気づき.*2.*件/ }).click();
		await expect.element(page.getByText(/気づきの内容A/)).toBeVisible();
		const dialogText = document.querySelector('[data-testid="dialog"]')?.textContent ?? '';
		expect(dialogText).toContain('Alice: 気づきの内容A');
		expect(dialogText).toContain('Bob: 気づきの内容B');
	});
});
