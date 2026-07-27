import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PersonaPostItem from '$lib/sharedComponents/PersonaPostItem.svelte';
import type { PersonaForDisplay } from '$lib/models/persona/persona.types';
import { FACILITATOR_NAME } from '$lib/models/turn/turn.constants';

// Admin・公開の双方が PersonaForDisplay を渡す。共通の1コンポーネントで発言（名前・役割・本文）を描画できることを検証する。
const persona: PersonaForDisplay = {
	id: 'p1',
	topicId: 't1',
	name: '田中',
	role: '救急医',
	colorKey: 'blue'
};

describe('PersonaPostItem（Admin・公開共通の発言アイテム）', () => {
	it('PersonaForDisplay を渡すと名前・役割・本文を描画する', async () => {
		render(PersonaPostItem, { persona, content: 'こんにちは' });
		await expect.element(page.getByText('田中')).toBeInTheDocument();
		await expect.element(page.getByText('救急医')).toBeInTheDocument();
		await expect.element(page.getByText('こんにちは')).toBeInTheDocument();
	});

	it('persona 欠落（ファシリテーター）は既定名へ縮退し役割を描画しない', async () => {
		render(PersonaPostItem, { content: '進行します' });
		await expect.element(page.getByText(FACILITATOR_NAME)).toBeInTheDocument();
		await expect.element(page.getByText('進行します')).toBeInTheDocument();
		expect(document.querySelector('.published-turn-item__role')).toBeNull();
	});
});
