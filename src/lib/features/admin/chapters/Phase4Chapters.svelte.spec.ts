import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return { id: 't1', title: 'テストテーマ', phase: 4, phaseStatus: 'generated' };
		},
		get sessionStore() {
			return {
				get session() {
					return {
						chapters: [{ title: 'はじめに', focusQuestion: '問題の本質は何か？' }],
						chapterIssues: null
					};
				}
			};
		}
	}
}));

import Phase4Chapters from './Phase4Chapters.svelte';

describe('Phase4Chapters.svelte', () => {
	it('章タイトルを表示する', async () => {
		render(Phase4Chapters);
		await expect.element(page.getByText('はじめに')).toBeInTheDocument();
	});

	it('フェーズタイトルを表示する', async () => {
		render(Phase4Chapters);
		await expect.element(page.getByText('フェーズ 4: 章立て')).toBeInTheDocument();
	});
});
