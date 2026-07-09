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
	it('章タイトルと論点を一覧表示する', async () => {
		render(DebateChapterIndex, { chapters: [chapter()], currentChapter: null });
		await expect.element(page.getByText('第一章')).toBeInTheDocument();
		await expect.element(page.getByText('論点A')).toBeInTheDocument();
		await expect.element(page.getByText('論点B')).toBeInTheDocument();
	});

	it('進行中の章は agendaItemStatuses の進捗バッジ（未/着/済）を出す', async () => {
		const running = chapter({
			status: 'running',
			agendaItemStatuses: [
				{ point: '論点A', status: 'addressed' },
				{ point: '論点B', status: 'introduced' }
			]
		});
		render(DebateChapterIndex, { chapters: [running], currentChapter: running });
		await expect.element(page.getByText('済')).toBeInTheDocument();
		await expect.element(page.getByText('着')).toBeInTheDocument();
	});
});
