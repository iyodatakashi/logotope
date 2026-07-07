import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return { id: 't1', title: 'テストテーマ', phase: 'personas', phaseStatus: 'generated' };
		},
		get personasStore() {
			return {
				get personas() {
					return [
						{
							id: 'p1',
							topicId: 't1',
							name: '田中太郎',
							stakeholderRole: '医師',
							age: 45,
							occupation: '外科医',
							background: '30年の経験',
							interests: '医療安全',
							approved: false,
							beliefs: [],
							sortOrder: 0
						}
					];
				}
			};
		}
	}
}));

import GeneratePersonasPage from '$lib/features/admin/topic-detail/personas/GeneratePersonasPage.svelte';

describe('GeneratePersonasPage.svelte', () => {
	it('ペルソナデータを表示する', async () => {
		render(GeneratePersonasPage);
		await expect.element(page.getByText('田中太郎')).toBeInTheDocument();
	});

	it('承認ボタンを表示する（PhasePanel経由、generated状態）', async () => {
		render(GeneratePersonasPage);
		await expect
			.element(page.getByRole('button', { name: '承認して次へ進む' }))
			.toBeInTheDocument();
	});
});
