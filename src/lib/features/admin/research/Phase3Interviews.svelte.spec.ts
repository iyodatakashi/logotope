import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return { id: 't1', title: 'テストテーマ', phase: 3, phaseStatus: 'generated' };
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
							background: '',
							interests: '',
							approved: true,
							beliefs: [{ version: 0, content: '初期信念の内容', createdAt: {} }],
							interview: { interviewRecord: '取材記録の内容', status: 'completed', completedAt: {} },
							sortOrder: 0
						}
					];
				},
				get isLoaded() {
					return true;
				},
				start: vi.fn(),
				stop: vi.fn(),
				runInterview: vi.fn()
			};
		}
	}
}));

import Phase3Interviews from './Phase3Interviews.svelte';

describe('Phase3Interviews.svelte', () => {
	it('取材済みのペルソナのデータを表示する', async () => {
		render(Phase3Interviews);
		await expect.element(page.getByText('田中太郎')).toBeInTheDocument();
	});

	it('全員完了時は承認ボタンを表示する（PhasePanel経由、generated状態）', async () => {
		render(Phase3Interviews);
		await expect.element(page.getByRole('button', { name: '承認して次へ進む' })).toBeInTheDocument();
	});
});
