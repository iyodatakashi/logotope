import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$lib/firebase.js', () => ({ db: {} }));
vi.mock('$lib/api/topics.js', () => ({ generatePersonas: vi.fn() }));
vi.mock('$lib/stores/personas.svelte.js', () => ({
	createPersonasStore: vi.fn(() => ({
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
	}))
}));
vi.mock('$lib/stores/topic.svelte.js', () => ({
	createTopicStore: vi.fn(() => ({
		get topic() {
			return { id: 't1', title: 'テストテーマ', status: 'generating_personas' };
		},
		get isLoaded() {
			return true;
		},
		start: vi.fn(),
		stop: vi.fn(),
		resetToPhase1: vi.fn()
	}))
}));

import Phase2Personas from './Phase2Personas.svelte';

describe('Phase2Personas.svelte', () => {
	it('通常時はアクションボタンを表示し、「前のフェーズに戻る」は存在しない', async () => {
		render(Phase2Personas, { topicId: 't1', topicTitle: 'テストテーマ' });

		await expect
			.element(page.getByRole('button', { name: '次のフェーズへ進む' }))
			.toBeInTheDocument();
		expect(page.getByRole('button', { name: '前のフェーズに戻る' }).elements()).toHaveLength(0);
	});

	it('readonly時はアクションUIを描画せずデータは表示する', async () => {
		render(Phase2Personas, { topicId: 't1', topicTitle: 'テストテーマ', readonly: true });

		await expect.element(page.getByText('田中太郎')).toBeInTheDocument();
		expect(page.getByRole('button', { name: '次のフェーズへ進む' }).elements()).toHaveLength(0);
		expect(page.getByRole('button', { name: 'ペルソナを生成する' }).elements()).toHaveLength(0);
	});
});
