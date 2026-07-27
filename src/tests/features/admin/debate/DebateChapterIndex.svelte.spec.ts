import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DebateChapterIndex from '$lib/features/admin/topic-detail/debate/DebateChapterIndex.svelte';
import type { Chapter } from '$lib/models/chapter/chapter.types';

const chapter = (overrides: Partial<Chapter> = {}): Chapter =>
	({
		id: 'ch1',
		chapterIndex: 0,
		title: '第一章',
		agenda: ['論点A', '論点B'],
		turns: [],
		status: 'pending',
		...overrides
	}) as Chapter;

describe('DebateChapterIndex.svelte（章と論点の目次）', () => {
	it('進行中でない章は章タイトルのみ表示し、論点は出さない', async () => {
		render(DebateChapterIndex, { chapters: [chapter()], currentChapter: null });
		await expect.element(page.getByText('第一章')).toBeInTheDocument();
		expect(page.getByText('論点A').elements()).toHaveLength(0);
		expect(page.getByText('論点B').elements()).toHaveLength(0);
	});

	it('進行中の章は agendaItemStatuses の進捗を論点ごとに data-status で出す', async () => {
		const running = chapter({
			status: 'running',
			agendaItemStatuses: [
				{ point: '論点A', status: 'addressed' },
				{ point: '論点B', status: 'introduced' }
			]
		});
		render(DebateChapterIndex, { chapters: [running], currentChapter: running });

		const statusOf = (point: string) =>
			page
				.getByText(point)
				.element()
				.closest('.debate-chapter-index__agenda-item')
				?.getAttribute('data-status');

		await expect.element(page.getByText('論点A')).toBeInTheDocument();
		expect(statusOf('論点A')).toBe('addressed');
		expect(statusOf('論点B')).toBe('introduced');
	});
});
