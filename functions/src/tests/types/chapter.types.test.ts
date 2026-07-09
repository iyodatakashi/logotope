import { describe, it, expect } from 'vitest';
import type {
	EditedChapterForFirestore,
	EditingChapterStatus
} from '../../types/chapter.types.js';

describe('chapter.types 編集後章（editorial から集約）', () => {
	it('編集状態（pending/completed/failed）を持つ編集後章を表現できる', () => {
		const statuses: EditingChapterStatus[] = ['pending', 'completed', 'failed'];
		for (const status of statuses) {
			const chapter: EditedChapterForFirestore = {
				chapterIndex: 0,
				title: '章タイトル',
				agenda: ['論点A'],
				turns: [],
				status
			};
			expect(chapter.status).toBe(status);
		}
	});

	it('検証不合格の理由（failureReason）を保持できる', () => {
		const chapter: EditedChapterForFirestore = {
			chapterIndex: 1,
			title: '章',
			agenda: [],
			turns: [],
			status: 'failed',
			failureReason: '原本に存在しない sourceTurnId: ghost'
		};
		expect(chapter.failureReason).toContain('ghost');
	});
});
