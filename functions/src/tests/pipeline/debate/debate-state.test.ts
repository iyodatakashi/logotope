/**
 * loadChapterProgress: 永続データ（chapter doc）から章進捗（quietStreak / 論点ステータス）を
 * 決定論的に復元することを検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Chapter } from '../../../types/chapter.types.js';

const mockGet = vi.fn();
const mockDoc = vi.fn(() => ({ get: mockGet }));
vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc }))
}));

import { loadChapterProgress } from '../../../pipeline/debate/debate-state.js';

const makeChapter = (discussionPoints: string[] = []): Chapter => ({
	id: 'ch1',
	title: 'テスト章',
	focusQuestion: 'テスト？',
	discussionPoints
});

describe('loadChapterProgress', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('quietStreak 未設定なら 0 を返す', async () => {
		mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
		const progress = await loadChapterProgress('t1', 'ch1', makeChapter(['論点A']));
		expect(progress.quietStreak).toBe(0);
	});

	it('quietStreak が永続化されていればその値を返す', async () => {
		mockGet.mockResolvedValue({ exists: true, data: () => ({ quietStreak: 4 }) });
		const progress = await loadChapterProgress('t1', 'ch1', makeChapter(['論点A']));
		expect(progress.quietStreak).toBe(4);
	});

	it('discussionPointStatuses 未設定なら章の論点から untouched 初期化する', async () => {
		mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
		const progress = await loadChapterProgress('t1', 'ch1', makeChapter(['論点A', '論点B']));
		expect(progress.discussionPointStatuses).toEqual([
			{ point: '論点A', status: 'untouched' },
			{ point: '論点B', status: 'untouched' }
		]);
	});

	it('discussionPointStatuses が永続化されていればそれを復元する', async () => {
		mockGet.mockResolvedValue({
			exists: true,
			data: () => ({
				discussionPointStatuses: [
					{ point: '論点A', status: 'addressed' },
					{ point: '論点B', status: 'introduced' }
				]
			})
		});
		const progress = await loadChapterProgress('t1', 'ch1', makeChapter(['論点A', '論点B']));
		expect(progress.discussionPointStatuses).toEqual([
			{ point: '論点A', status: 'addressed' },
			{ point: '論点B', status: 'introduced' }
		]);
	});

	it('論点のない章では空配列を返す', async () => {
		mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
		const progress = await loadChapterProgress('t1', 'ch1', makeChapter([]));
		expect(progress.discussionPointStatuses).toEqual([]);
	});

	it('同一の永続データから同一の出力を返す（決定論）', async () => {
		mockGet.mockResolvedValue({
			exists: true,
			data: () => ({
				quietStreak: 2,
				discussionPointStatuses: [{ point: '論点A', status: 'introduced' }]
			})
		});
		const a = await loadChapterProgress('t1', 'ch1', makeChapter(['論点A']));
		const b = await loadChapterProgress('t1', 'ch1', makeChapter(['論点A']));
		expect(a).toEqual(b);
	});
});
