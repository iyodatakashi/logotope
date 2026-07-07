import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return { id: 't1', title: 'テストテーマ', phase: 'chapters', phaseStatus: 'generated' };
		},
		get chaptersStore() {
			return {
				get chapters() {
					return [
						{
							id: 'ch1',
							chapterIndex: 0,
							title: 'はじめに',
							discussionPoints: [],
							turns: [],
							status: 'pending'
						}
					];
				}
			};
		},
		get chapterAnalysisStore() {
			return {
				get data() {
					return null;
				}
			};
		}
	}
}));

import GenerateChaptersPage from '$lib/features/admin/topic-detail/chapters/GenerateChaptersPage.svelte';

describe('GenerateChaptersPage.svelte', () => {
	it('章タイトルを表示する', async () => {
		render(GenerateChaptersPage);
		await expect.element(page.getByText('はじめに')).toBeInTheDocument();
	});
});
