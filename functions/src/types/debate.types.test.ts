import { describe, it, expect } from 'vitest';
import type {
	Engagement,
	PersonaReply,
	DebateTurn,
	TurnGenerationContext,
	DiscussionPointStatus,
	DiscussionPointState,
	DebateState,
	FacilitatorReply,
	ChapterStateData,
	ChapterProgressStatus,
} from './debate.types.js';
import type { Chapter } from './chapter.types.js';

describe('debate.types - questionモード型定義', () => {
	it('Engagement.mode に question が含まれる', () => {
		const engagement: Engagement = {
			personaId: 'p1',
			score: 4,
			mode: 'question',
			intentSummary: '○○さんの意見の根拠を確認したい',
		};
		expect(engagement.mode).toBe('question');
	});

	it('PersonaReply.speechMode に question が含まれる', () => {
		const reply: PersonaReply = {
			content: 'テスト発言',
			speechMode: 'question',
			beliefChange: null,
			targetPersonaId: 'p2',
		};
		expect(reply.speechMode).toBe('question');
	});

	it('DebateTurn.speechMode に question が含まれる', () => {
		const turn: DebateTurn = {
			id: 'turn1',
			speakerType: 'persona',
			content: 'テスト発言',
			createdAt: '2026-01-01T00:00:00Z',
			speechMode: 'question',
		};
		expect(turn.speechMode).toBe('question');
	});

	it('TurnGenerationContext に otherPersonas フィールドが含まれる', () => {
		const context: TurnGenerationContext = {
			chapterTurns: [],
			chapter: { id: 'ch1', title: 'テスト', focusQuestion: 'テスト？' },
			otherPersonas: [{ id: 'p2', name: 'ペルソナB' }],
		};
		expect(context.otherPersonas).toHaveLength(1);
		expect(context.otherPersonas[0].id).toBe('p2');
	});

	it('TurnGenerationContext.otherPersonas は空配列も受け入れる', () => {
		const context: TurnGenerationContext = {
			chapterTurns: [],
			chapter: { id: 'ch1', title: 'テスト', focusQuestion: 'テスト？' },
			otherPersonas: [],
		};
		expect(context.otherPersonas).toHaveLength(0);
	});
});

describe('debate.types - 論点追跡型定義', () => {
	it('DiscussionPointStatus は3ステータスを表す', () => {
		const statuses: DiscussionPointStatus[] = ['untouched', 'introduced', 'addressed'];
		expect(statuses).toHaveLength(3);
	});

	it('DiscussionPointState は論点とステータスを持つ', () => {
		const state: DiscussionPointState = {
			point: '自由とは何か',
			status: 'untouched',
		};
		expect(state.point).toBe('自由とは何か');
		expect(state.status).toBe('untouched');
	});

	it('DebateState に discussionPoints フィールドが含まれる', () => {
		const state: DebateState = {
			turns: [],
			silenceMap: new Map(),
			speakCount: new Map(),
			queuedIntents: new Map(),
			pairConversationTurns: 0,
			discussionPoints: [{ point: '論点1', status: 'introduced' }],
		};
		expect(state.discussionPoints).toHaveLength(1);
		expect(state.discussionPoints[0].status).toBe('introduced');
	});

	it('FacilitatorReply に selectedDiscussionPointIndex が含まれる', () => {
		const reply: FacilitatorReply = {
			content: 'では次の論点に移りましょう',
			selectedDiscussionPointIndex: 2,
		};
		expect(reply.selectedDiscussionPointIndex).toBe(2);
	});

	it('Chapter に discussionPoints フィールドが含まれる', () => {
		const chapter: Chapter = {
			id: 'ch1',
			title: 'テスト章',
			focusQuestion: 'テスト？',
			discussionPoints: ['論点A', '論点B', '論点C'],
		};
		expect(chapter.discussionPoints).toHaveLength(3);
	});
});

describe('debate.types - チャプタードキュメント型定義', () => {
	it('ChapterStateData は章メタ・ターン配列・進行ステータスを持つ', () => {
		const chapter: ChapterStateData = {
			chapterIndex: 0,
			title: '導入',
			focusQuestion: 'この問題の核心は何か？',
			discussionPoints: ['論点A', '論点B'],
			turns: [],
			status: 'pending',
		};
		expect(chapter.chapterIndex).toBe(0);
		expect(chapter.turns).toHaveLength(0);
		expect(chapter.status).toBe('pending');
	});

	it('ChapterStateData は discussionPointStatuses を任意で持つ', () => {
		const chapter: ChapterStateData = {
			chapterIndex: 1,
			title: '核心',
			focusQuestion: '最も意見が分かれる点は？',
			discussionPoints: ['論点A'],
			turns: [],
			discussionPointStatuses: [{ point: '論点A', status: 'introduced' }],
			status: 'running',
		};
		expect(chapter.discussionPointStatuses).toHaveLength(1);
	});

	it('ChapterProgressStatus は3つの進行状態を表す', () => {
		const statuses: ChapterProgressStatus[] = ['pending', 'running', 'completed'];
		expect(statuses).toHaveLength(3);
	});

	it('DebateTurn は chapterId なしで構築できる', () => {
		const turn: DebateTurn = {
			id: 'turn1',
			speakerType: 'persona',
			content: 'テスト発言',
			createdAt: '2026-01-01T00:00:00Z',
		};
		expect(turn).not.toHaveProperty('chapterId');
	});
});
