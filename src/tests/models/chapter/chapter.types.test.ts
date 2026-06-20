import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { ChapterDoc, ChapterAnalysisDoc } from '$lib/models/chapter/chapter.types';
import type { TurnDoc } from '$lib/models/turn/turn.types';

describe('chapter.types - チャプタードキュメント型定義', () => {
	it('ChapterDoc は章メタ・ターン配列・進行ステータスを持つ', () => {
		const chapter: ChapterDoc = {
			chapterIndex: 0,
			title: '導入',
			focusQuestion: 'この問題の核心は何か？',
			discussionPoints: ['論点A', '論点B'],
			turns: [],
			status: 'pending',
		};
		expect(chapter.chapterIndex).toBe(0);
		expect(chapter.status).toBe('pending');
	});

	it('ChapterDoc は turns と discussionPointStatuses を保持する', () => {
		const turn: TurnDoc = {
			id: 't1',
			speakerType: 'persona',
			content: 'テスト発言',
			createdAt: Timestamp.fromDate(new Date()),
		};
		const chapter: ChapterDoc = {
			chapterIndex: 1,
			title: '核心',
			focusQuestion: '最も意見が分かれる点は？',
			discussionPoints: ['論点A'],
			turns: [turn],
			discussionPointStatuses: [{ point: '論点A', status: 'introduced' }],
			status: 'running',
		};
		expect(chapter.turns).toHaveLength(1);
		expect(chapter.discussionPointStatuses).toHaveLength(1);
	});

	it('ChapterAnalysisDoc は general と persona を持つ', () => {
		const analysis: ChapterAnalysisDoc = {
			general: ['一般的切り口'],
			persona: ['ペルソナ別切り口'],
		};
		expect(analysis.general).toHaveLength(1);
		expect(analysis.persona).toHaveLength(1);
	});
});
