import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return { id: 't1', title: 'テストテーマ', status: 'generating_personas', generatePersonas: vi.fn() };
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
							stanceDirection: 'pro',
							approved: false,
							beliefs: [],
							sortOrder: 0
						}
					];
				},
				get isLoaded() {
					return true;
				},
				start: vi.fn(),
				stop: vi.fn(),
				approvePersonas: vi.fn()
			};
		}
	}
}));

import Phase2Personas from './Phase2Personas.svelte';

describe('Phase2Personas.svelte', () => {
	it('ペルソナが存在する場合は承認ボタンを表示する', async () => {
		render(Phase2Personas, { topicId: 't1', topicTitle: 'テストテーマ' });

		await expect.element(page.getByRole('button', { name: '承認する' })).toBeInTheDocument();
	});

	it('ペルソナデータを表示する', async () => {
		render(Phase2Personas, { topicId: 't1', topicTitle: 'テストテーマ' });

		await expect.element(page.getByText('田中太郎')).toBeInTheDocument();
	});
});
