import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PersonaFilter from '$lib/features/topics/detail/PersonaFilter.svelte';
import type { PersonaSummaryForViewer } from '$lib/models/persona/persona.types';

const personas: PersonaSummaryForViewer[] = [
	{ id: 'p-1', name: '田中太郎', role: '中小企業経営者', beliefHistory: [] },
	{ id: 'p-2', name: '鈴木花子', role: '消費者代表', beliefHistory: [] }
];

describe('PersonaFilter.svelte', () => {
	it('全ペルソナ名を表示する', async () => {
		render(PersonaFilter, { personas, selectedPersonaId: null });
		await expect.element(page.getByText('田中太郎')).toBeInTheDocument();
		await expect.element(page.getByText('鈴木花子')).toBeInTheDocument();
	});

	it('「全員」ボタンを持つ', async () => {
		render(PersonaFilter, { personas, selectedPersonaId: null });
		await expect.element(page.getByRole('button', { name: '全員' })).toBeInTheDocument();
	});

	it('選択中のペルソナにactive状態を表示する', async () => {
		render(PersonaFilter, { personas, selectedPersonaId: 'p-1' });
		const btn = page.getByRole('button', { name: '田中太郎' });
		await expect.element(btn).toHaveAttribute('aria-pressed', 'true');
	});

	it('全員ボタン押下で selectedPersonaId が null になる', async () => {
		let current: string | null = 'p-1';
		render(PersonaFilter, {
			personas,
			get selectedPersonaId() {
				return current;
			},
			onselect: (id: string | null) => {
				current = id;
			}
		});
		await page.getByRole('button', { name: '全員' }).click();
		expect(current).toBeNull();
	});
});
