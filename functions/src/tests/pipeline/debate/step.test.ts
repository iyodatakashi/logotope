/**
 * step.ts のカバレッジ配線（5.1 / 5.2）を検証する。
 * - 5.1: 通常ターンのコミット後に現アクティブ論点へ話者を冪等記録し、saveDiscussionPointStatuses で永続化する。
 * - 5.2: オープニングの論点投入で、ファシリテーター返却の関連参加者を（有効IDへフィルタして）記録する。
 * discussion-points.js は実物を使い、I/O 依存（agents / turn / firestore 等）のみモックする。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DebateState } from '../../../types/debate.types.js';
import type { DebateTurn } from '../../../types/turn.types.js';
import type { Persona } from '../../../types/persona.types.js';
import type { StepContext, StepPayload } from '../../../types/step.types.js';
import type { Chapter, ChapterEntry } from '../../../types/chapter.types.js';

const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn(() => ({ update: mockUpdate }));
vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc })),
	Timestamp: { now: () => ({ toDate: () => new Date() }) },
	FieldValue: { delete: vi.fn(() => 'DELETE'), arrayUnion: vi.fn((...a: unknown[]) => a) }
}));

vi.mock('../../../agents/facilitator-agent.js', () => ({
	generateOpening: vi.fn(),
	generateChapterIntroduction: vi.fn(),
	evaluateDiscussionPointCoverage: vi.fn()
}));
vi.mock('../../../pipeline/debate/turn.js', () => ({
	generateFacilitatorTurn: vi.fn(),
	generatePersonaTurn: vi.fn(),
	generateChapterTransition: vi.fn(),
	appendClosingTurn: vi.fn()
}));
vi.mock('../../../pipeline/debate/chapter.js', () => ({
	updateChapterStatus: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../../../pipeline/debate/engagement.js', () => ({
	evaluateEngagements: vi.fn().mockResolvedValue([]),
	evaluateEngagementWithFallback: vi
		.fn()
		.mockResolvedValue({ personaId: 'p1', score: 0, mode: 'none' })
}));
vi.mock('../../../pipeline/debate/speaker-selection.js', () => ({
	selectSpeaker: vi.fn(() => ({ personaId: 'p1', reason: 'score' })),
	hasHighEngagement: vi.fn(() => false)
}));
vi.mock('../../../pipeline/debate/queued-intents.js', () => ({
	expireQueuedIntents: vi.fn().mockResolvedValue(undefined),
	addQueuedIntents: vi.fn().mockResolvedValue(undefined),
	consumeQueuedIntent: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../../../pipeline/debate/belief.js', () => ({
	applyBeliefChange: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../../../pipeline/debate/debate-state.js', () => ({
	updateSpeakerStats: vi.fn()
}));
vi.mock('../../../pipeline/debate/intervention.js', () => ({
	tryIntervention: vi.fn().mockResolvedValue(false),
	countConsecutivePersonaTargets: vi.fn(() => 0)
}));
vi.mock('../../../pipeline/debate/post-debate-comments.js', () => ({
	persistPostDebateComments: vi.fn().mockResolvedValue(undefined)
}));

import { performOpenStep, performTurnStep } from '../../../pipeline/debate/step.js';
import { generateOpening } from '../../../agents/facilitator-agent.js';
import { generateFacilitatorTurn, generatePersonaTurn } from '../../../pipeline/debate/turn.js';

const personas: Persona[] = [
	{ id: 'p1', name: 'P1' } as Persona,
	{ id: 'p2', name: 'P2' } as Persona
];

const makeChapter = (discussionPoints: string[] = []): Chapter => ({
	id: 'ch1',
	title: 'テスト章',
	discussionPoints
});

const makeState = (
	turns: DebateTurn[] = [],
	discussionPoints: DebateState['discussionPoints'] = []
): DebateState => ({
	turns: [...turns],
	lastSpeakerId: undefined,
	silenceMap: new Map(),
	speakCount: new Map(),
	queuedIntents: new Map(),
	discussionPoints
});

const makeCtx = (overrides: Partial<StepContext>): StepContext => {
	const chapter = (overrides.chapter as Chapter) ?? makeChapter();
	const chapterDoc = (overrides.chapterDoc as ChapterEntry) ?? {
		id: 'ch1',
		chapterIndex: 0,
		title: 'テスト章',
		discussionPoints: chapter.discussionPoints,
		turns: [],
		status: 'pending'
	};
	return {
		chapters: [chapterDoc],
		chapterDoc,
		chapter,
		personas,
		topicTitle: 'テーマ',
		state: makeState(),
		chapterTurnStartInState: 0,
		quietStreak: 0,
		isLastChapter: false,
		...overrides
	};
};

const makePayload = (overrides: Partial<StepPayload> = {}): StepPayload => ({
	topicId: 'topic1',
	chapterIndex: 0,
	runId: 'run1',
	stepKind: 'turn',
	expectedTurnIndex: 0,
	...overrides
});

describe('performOpenStep - 関連参加者記録の配線（5.2）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('オープニングの論点投入で、有効IDへフィルタした関連参加者を記録し発言済みを空初期化する', async () => {
		vi.mocked(generateOpening).mockResolvedValue({
			ok: true,
			value: {
				content: '問いかけ',
				targetPersonaId: 'p1',
				selectedDiscussionPointIndex: 0,
				relevantPersonaIds: ['p1', 'p2', 'pX'] // pX は非参加者 → フィルタされる
			}
		});
		vi.mocked(generateFacilitatorTurn).mockResolvedValue({ status: 'committed', id: 'f1' });

		const ctx = makeCtx({ chapter: makeChapter(['論点1']) });
		await performOpenStep(ctx, makePayload({ stepKind: 'open' }));

		const active = ctx.state.discussionPoints[0];
		expect(active.status).toBe('introduced');
		expect(active.relevantPersonaIds).toEqual(['p1', 'p2']);
		expect(active.spokenPersonaIds).toEqual([]);
	});
});

describe('performTurnStep - 発言者記録の配線（5.1）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('通常ターンのコミット後、現アクティブ論点へ話者を記録し永続化する', async () => {
		vi.mocked(generatePersonaTurn).mockResolvedValue({
			personaId: 'p1',
			turnId: 'tn1',
			beliefChange: null,
			queuedEntries: []
		} as never);

		// アクティブ論点C（introduced）。発言者 p1 が記録されるべき
		const state = makeState(
			[{ id: 't0', speakerType: 'facilitator', content: '導入', createdAt: '' }],
			[
				{
					point: '論点C',
					status: 'introduced',
					introducedOrder: 1,
					relevantPersonaIds: ['p1'],
					spokenPersonaIds: []
				}
			]
		);
		const chapterDoc: ChapterEntry = {
			id: 'ch1',
			chapterIndex: 0,
			title: 'テスト章',
			discussionPoints: ['論点C'],
			turns: [{ id: 't0', speakerType: 'facilitator', content: '導入', createdAt: '' }],
			status: 'running'
		};
		const ctx = makeCtx({ chapterDoc, state, chapterTurnStartInState: 0 });

		await performTurnStep(ctx, makePayload({ stepKind: 'turn', expectedTurnIndex: 1 }), {
			turnsPerChapter: 10,
			maxTurns: 100,
			interventionCooldown: 2
		});

		expect(ctx.state.discussionPoints[0].spokenPersonaIds).toContain('p1');
		// state ベースの書き出しで永続化される（discussionPointStatuses の update が呼ばれる）
		expect(mockUpdate).toHaveBeenCalled();
	});
});
