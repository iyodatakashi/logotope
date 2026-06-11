import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$lib/firebase.js', () => ({ db: {} }));
vi.mock('$lib/api/topics.js', () => ({ runInterview: vi.fn() }));
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
					background: '',
					interests: '',
					stanceDirection: 'pro',
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
		stop: vi.fn()
	}))
}));
vi.mock('$lib/stores/topic.svelte.js', () => ({
	createTopicStore: vi.fn(() => ({
		get topic() {
			return { id: 't1', title: 'テストテーマ', status: 'interviewing' };
		},
		get isLoaded() {
			return true;
		},
		start: vi.fn(),
		stop: vi.fn(),
		resetToPhase2: vi.fn(),
		approveInterviews: vi.fn()
	}))
}));

import Phase3Interviews from './Phase3Interviews.svelte';

describe('Phase3Interviews.svelte', () => {
	it('通常時はアクションボタンを表示し、「前のフェーズに戻る」は存在しない', async () => {
		render(Phase3Interviews, { topicId: 't1', topicTitle: 'テストテーマ' });

		await expect
			.element(page.getByRole('button', { name: '次のフェーズへ進む' }))
			.toBeInTheDocument();
		expect(page.getByRole('button', { name: '前のフェーズに戻る' }).elements()).toHaveLength(0);
	});

	it('readonly時はアクションUIを描画せずデータは表示する', async () => {
		render(Phase3Interviews, { topicId: 't1', topicTitle: 'テストテーマ', readonly: true });

		await expect.element(page.getByText('田中太郎')).toBeInTheDocument();
		expect(page.getByRole('button', { name: '次のフェーズへ進む' }).elements()).toHaveLength(0);
		expect(page.getByRole('button', { name: '取材を開始する' }).elements()).toHaveLength(0);
	});
});
