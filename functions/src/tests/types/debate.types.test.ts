import { describe, it, expect } from 'vitest';
import type {
	Engagement,
	PersonaReply,
	DebateState,
	FacilitatorReply
} from '../../types/debate.types.js';
import type {
	DiscussionPointStatus,
	DiscussionPointState,
	ChapterForFirestore,
	ChapterProgressStatus,
	ChapterProgress
} from '../../types/chapter.types.js';
import type {
	DebateTurn,
	TurnGenerationContext,
	NewTurnFields,
	ProgressPatch,
	AppendTurnInput,
	AppendResult
} from '../../types/turn.types.js';
import type { StepKind, StepPayload, NextStep } from '../../types/step.types.js';
import type { Chapter } from '../../types/chapter.types.js';

describe('debate.types - questionモード型定義', () => {
	it('Engagement.mode に question が含まれる', () => {
		const engagement: Engagement = {
			personaId: 'p1',
			score: 4,
			mode: 'question',
			intentSummary: '○○さんの意見の根拠を確認したい'
		};
		expect(engagement.mode).toBe('question');
	});

	it('PersonaReply.speechMode に question が含まれる', () => {
		const reply: PersonaReply = {
			content: 'テスト発言',
			speechMode: 'question',
			beliefChange: null,
			targetPersonaId: 'p2'
		};
		expect(reply.speechMode).toBe('question');
	});

	it('DebateTurn.speechMode に question が含まれる', () => {
		const turn: DebateTurn = {
			id: 'turn1',
			speakerType: 'persona',
			content: 'テスト発言',
			createdAt: '2026-01-01T00:00:00Z',
			speechMode: 'question'
		};
		expect(turn.speechMode).toBe('question');
	});

	it('TurnGenerationContext に otherPersonas フィールドが含まれる', () => {
		const context: TurnGenerationContext = {
			chapterTurns: [],
			chapter: { id: 'ch1', title: 'テスト' },
			otherPersonas: [{ id: 'p2', name: 'ペルソナB' }]
		};
		expect(context.otherPersonas).toHaveLength(1);
		expect(context.otherPersonas[0].id).toBe('p2');
	});

	it('TurnGenerationContext.otherPersonas は空配列も受け入れる', () => {
		const context: TurnGenerationContext = {
			chapterTurns: [],
			chapter: { id: 'ch1', title: 'テスト' },
			otherPersonas: []
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
			status: 'untouched'
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
			discussionPoints: [{ point: '論点1', status: 'introduced' }]
		};
		expect(state.discussionPoints).toHaveLength(1);
		expect(state.discussionPoints[0].status).toBe('introduced');
	});

	it('FacilitatorReply に selectedDiscussionPointIndex が含まれる', () => {
		const reply: FacilitatorReply = {
			content: 'では次の論点に移りましょう',
			selectedDiscussionPointIndex: 2
		};
		expect(reply.selectedDiscussionPointIndex).toBe(2);
	});

	it('Chapter に discussionPoints フィールドが含まれる', () => {
		const chapter: Chapter = {
			id: 'ch1',
			title: 'テスト章',
			discussionPoints: ['論点A', '論点B', '論点C']
		};
		expect(chapter.discussionPoints).toHaveLength(3);
	});
});

describe('debate.types - チャプタードキュメント型定義', () => {
	it('ChapterForFirestore は章メタ・ターン配列・進行ステータスを持つ', () => {
		const chapter: ChapterForFirestore = {
			chapterIndex: 0,
			title: '導入',
			discussionPoints: ['論点A', '論点B'],
			turns: [],
			status: 'pending'
		};
		expect(chapter.chapterIndex).toBe(0);
		expect(chapter.turns).toHaveLength(0);
		expect(chapter.status).toBe('pending');
	});

	it('ChapterForFirestore は discussionPointStatuses を任意で持つ', () => {
		const chapter: ChapterForFirestore = {
			chapterIndex: 1,
			title: '核心',
			discussionPoints: ['論点A'],
			turns: [],
			discussionPointStatuses: [{ point: '論点A', status: 'introduced' }],
			status: 'running'
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
			createdAt: '2026-01-01T00:00:00Z'
		};
		expect(turn).not.toHaveProperty('chapterId');
	});

	it('ChapterForFirestore は quietStreak を任意で持つ', () => {
		const chapter: ChapterForFirestore = {
			chapterIndex: 0,
			title: '導入',
			discussionPoints: ['論点A'],
			turns: [],
			quietStreak: 2,
			status: 'running'
		};
		expect(chapter.quietStreak).toBe(2);
	});

	it('ChapterForFirestore は quietStreak 未設定でも構築できる（未設定=0扱い）', () => {
		const chapter: ChapterForFirestore = {
			chapterIndex: 0,
			title: '導入',
			discussionPoints: ['論点A'],
			turns: [],
			status: 'pending'
		};
		expect(chapter.quietStreak).toBeUndefined();
	});

	it('ChapterProgress は章終了カウンタと論点ステータスを持つ', () => {
		const progress: ChapterProgress = {
			quietStreak: 0,
			discussionPointStatuses: [{ point: '論点A', status: 'untouched' }]
		};
		expect(progress.quietStreak).toBe(0);
		expect(progress.discussionPointStatuses).toHaveLength(1);
	});
});

describe('debate.types - ターン追記入力・結果型定義', () => {
	it('NewTurnFields は永続化前のターンフィールドを表す', () => {
		const turn: NewTurnFields = {
			speakerType: 'persona',
			personaId: 'p1',
			content: 'テスト発言',
			speechMode: 'opinion',
			targetPersonaId: 'p2',
			targetedBy: 'persona'
		};
		expect(turn.speakerType).toBe('persona');
		expect(turn).not.toHaveProperty('id');
		expect(turn).not.toHaveProperty('createdAt');
	});

	it('ProgressPatch は quietStreak と discussionPointStatuses を任意で持つ', () => {
		const patch: ProgressPatch = {
			quietStreak: 1,
			discussionPointStatuses: [{ point: '論点A', status: 'addressed' }]
		};
		expect(patch.quietStreak).toBe(1);
		expect(patch.discussionPointStatuses).toHaveLength(1);
	});

	it('AppendTurnInput は expectedTurnIndex と progressPatch を持つ', () => {
		const input: AppendTurnInput = {
			topicId: 't1',
			chapterId: 'ch1',
			expectedTurnIndex: 3,
			turn: { speakerType: 'facilitator', content: 'まとめ' },
			runId: 'run-1',
			progressPatch: { quietStreak: 0 }
		};
		expect(input.expectedTurnIndex).toBe(3);
		expect(input.progressPatch?.quietStreak).toBe(0);
	});

	it('AppendTurnInput は runId・progressPatch なしでも構築できる（後方互換）', () => {
		const input: AppendTurnInput = {
			topicId: 't1',
			chapterId: 'ch1',
			expectedTurnIndex: 0,
			turn: { speakerType: 'persona', personaId: 'p1', content: '発言' }
		};
		expect(input.runId).toBeUndefined();
		expect(input.progressPatch).toBeUndefined();
	});

	it('AppendResult は committed で id を持つ', () => {
		const result: AppendResult = { status: 'committed', id: 'turn-1' };
		expect(result.status).toBe('committed');
		if (result.status === 'committed') expect(result.id).toBe('turn-1');
	});

	it('AppendResult は rejected で reason を3種から持つ', () => {
		const reasons: AppendResult[] = [
			{ status: 'rejected', reason: 'index_mismatch' },
			{ status: 'rejected', reason: 'generation_mismatch' },
			{ status: 'rejected', reason: 'debate_inactive' }
		];
		expect(reasons).toHaveLength(3);
		expect(reasons.every((r) => r.status === 'rejected')).toBe(true);
	});
});

describe('debate.types - ステップ・次ステップ判定型定義', () => {
	it('StepKind は5種のステップ種別を表す', () => {
		const kinds: StepKind[] = ['open', 'turn', 'summary', 'closing', 'comments'];
		expect(kinds).toHaveLength(5);
	});

	it('StepPayload はステップ実行に必要な情報を持つ', () => {
		const payload: StepPayload = {
			topicId: 't1',
			chapterIndex: 0,
			runId: 'run-1',
			stepKind: 'turn',
			expectedTurnIndex: 5,
			singleChapterMode: true
		};
		expect(payload.stepKind).toBe('turn');
		expect(payload.expectedTurnIndex).toBe(5);
	});

	it('NextStep は各遷移を判別共用体で表す', () => {
		const steps: NextStep[] = [
			{ kind: 'turn', expectedTurnIndex: 1 },
			{ kind: 'summary', expectedTurnIndex: 10 },
			{ kind: 'closing', expectedTurnIndex: 12 },
			{ kind: 'open', chapterIndex: 1, expectedTurnIndex: 0 },
			{ kind: 'comments' },
			{ kind: 'none' }
		];
		expect(steps).toHaveLength(6);
		const open = steps.find((s) => s.kind === 'open');
		if (open && open.kind === 'open') expect(open.chapterIndex).toBe(1);
	});
});
