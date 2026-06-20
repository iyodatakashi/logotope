import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type {
	ChapterStateDoc,
	ChapterAnalysisDoc,
	PostDebateCommentsDoc,
	ChapterDoc,
	TurnDoc,
} from './session.types';

describe('session.types - チャプタードキュメント型定義', () => {
	it('ChapterStateDoc は章メタ・ターン配列・進行ステータスを持つ', () => {
		const chapter: ChapterStateDoc = {
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

	it('ChapterStateDoc は turns と discussionPointStatuses を保持する', () => {
		const turn: TurnDoc = {
			id: 't1',
			turnIndex: 0,
			speakerType: 'persona',
			content: 'テスト発言',
			createdAt: Timestamp.now(),
		};
		const chapter: ChapterStateDoc = {
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

	it('PostDebateCommentsDoc は comments 配列を持つ', () => {
		const doc: PostDebateCommentsDoc = {
			comments: [{ id: 'c1', personaId: 'p1', content: 'コメント', sortOrder: 0 }],
		};
		expect(doc.comments).toHaveLength(1);
	});

	it('ChapterDoc は startTurnIndex を持たない', () => {
		const chapter: ChapterDoc = {
			title: '導入',
			focusQuestion: 'この問題の核心は何か？',
		};
		expect(chapter).not.toHaveProperty('startTurnIndex');
	});
});
