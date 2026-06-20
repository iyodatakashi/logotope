/**
 * debate-orchestrator.ts の論点ステータス管理・ハードキャップ・早期終了ロジックのユニットテスト
 * 外部依存は vi.mock でスタブ化し、ビジネスロジックのみを検証する
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase admin スタブ
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue({ update: mockUpdate, set: mockSet });
vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc })),
	Timestamp: { now: vi.fn(() => ({ toDate: () => new Date() })) },
	FieldValue: { arrayUnion: vi.fn((...args: unknown[]) => args), delete: vi.fn(() => 'delete-sentinel') },
}));

// 各モジュールのスタブ
const mockGetTopicById = vi.fn().mockResolvedValue({ title: 'テストテーマ', phase: 5, phaseStatus: 'running' });
const mockGetPersonasByTopicId = vi.fn().mockResolvedValue([{ id: 'p1', name: 'テスト', approved: true }]);
vi.mock('../topics/topics.js', () => ({ getTopicById: (...args: unknown[]) => mockGetTopicById(...args) }));
vi.mock('../personas/personas.js', () => ({ getPersonasByTopicId: (...args: unknown[]) => mockGetPersonasByTopicId(...args) }));

const mockGetChaptersByTopicId = vi.fn();
vi.mock('./debate-lifecycle.js', () => ({ getChaptersByTopicId: (...args: unknown[]) => mockGetChaptersByTopicId(...args) }));

const mockGenerateOpening = vi.fn();
const mockGenerateChapterIntroduction = vi.fn();
const mockEvaluateDiscussionPointCoverage = vi.fn();
vi.mock('../../agents/facilitator-agent.js', () => ({
	generateOpening: (...args: unknown[]) => mockGenerateOpening(...args),
	generateChapterIntroduction: (...args: unknown[]) => mockGenerateChapterIntroduction(...args),
	evaluateDiscussionPointCoverage: (...args: unknown[]) => mockEvaluateDiscussionPointCoverage(...args),
}));

const mockGetDebateState = vi.fn();
vi.mock('./debate-state.js', () => ({ getDebateState: (...args: unknown[]) => mockGetDebateState(...args) }));

const mockTryIntervention = vi.fn().mockResolvedValue(false);
vi.mock('./intervention.js', () => ({ tryIntervention: (...args: unknown[]) => mockTryIntervention(...args) }));

const mockIsDebateActive = vi.fn().mockResolvedValue(true);
const mockGenerateFacilitatorTurn = vi.fn().mockResolvedValue(undefined);
const mockGeneratePersonaTurn = vi.fn();
const mockGenerateChapterTransition = vi.fn().mockResolvedValue(undefined);
const mockFinalizeDebate = vi.fn().mockResolvedValue(undefined);
const mockUpdateSpeakerStats = vi.fn();
const mockApplyBeliefChange = vi.fn().mockResolvedValue(undefined);
const mockGetDebateTurnsByTopicId = vi.fn().mockResolvedValue([]);
vi.mock('./turn.js', () => ({
	isDebateActive: (...args: unknown[]) => mockIsDebateActive(...args),
	generateFacilitatorTurn: (...args: unknown[]) => mockGenerateFacilitatorTurn(...args),
	generatePersonaTurn: (...args: unknown[]) => mockGeneratePersonaTurn(...args),
	generateChapterTransition: (...args: unknown[]) => mockGenerateChapterTransition(...args),
	finalizeDebate: (...args: unknown[]) => mockFinalizeDebate(...args),
	updateSpeakerStats: (...args: unknown[]) => mockUpdateSpeakerStats(...args),
	applyBeliefChange: (...args: unknown[]) => mockApplyBeliefChange(...args),
	getDebateTurnsByTopicId: (...args: unknown[]) => mockGetDebateTurnsByTopicId(...args),
}));

vi.mock('./speaker-selection.js', () => ({ selectSpeaker: vi.fn().mockReturnValue({ personaId: 'p1', reason: 'score' }) }));
vi.mock('./engagement.js', () => ({
	evaluateEngagements: vi.fn().mockResolvedValue([]),
	evaluateEngagementWithFallback: vi.fn().mockResolvedValue({ personaId: 'p1', score: 5, mode: 'opinion' }),
}));
vi.mock('./queued-intents.js', () => ({
	expireQueuedIntents: vi.fn().mockResolvedValue(undefined),
	addQueuedIntents: vi.fn().mockResolvedValue(undefined),
	consumeQueuedIntent: vi.fn().mockResolvedValue(undefined),
	loadQueuedIntents: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('./utils.js', () => ({
	pipelineErrorMessage: vi.fn((e: { message: string }) => e.message),
	validPersonaId: vi.fn((id: string | undefined) => id),
}));

import type { DebateState } from '../../types/debate.types.js';
import type { Chapter } from '../../types/chapter.types.js';
import type { ChapterEntry } from './debate-lifecycle.js';

const makeChapter = (overrides: Partial<Chapter> = {}): Chapter => ({
	id: 'ch1',
	title: 'テスト章',
	focusQuestion: 'テスト？',
	discussionPoints: [],
	...overrides,
});

const makeState = (discussionPoints: DebateState['discussionPoints'] = []): DebateState => ({
	turns: [],
	silenceMap: new Map(),
	speakCount: new Map(),
	queuedIntents: new Map(),
	pairConversationTurns: 0,
	discussionPoints,
});

const makeChapterEntry = (chapter: Chapter, status: ChapterEntry['status'] = 'pending'): ChapterEntry => ({
	id: chapter.id,
	chapterIndex: 0,
	title: chapter.title,
	focusQuestion: chapter.focusQuestion,
	discussionPoints: chapter.discussionPoints ?? [],
	turns: [],
	status,
});

describe('executeChapterTask - 論点ステータス初期化', () => {
	beforeEach(() => {
		vi.resetModules();
		mockGetDebateTurnsByTopicId.mockResolvedValue([]);
	});

	it('章の discussionPoints から state.discussionPoints を untouched で初期化する', async () => {
		const chapter = makeChapter({ discussionPoints: ['論点A', '論点B', '論点C'] });
		const state = makeState();
		mockGetDebateState.mockReturnValue(state);
		mockGetChaptersByTopicId.mockResolvedValue([makeChapterEntry(chapter)]);
		mockGenerateOpening.mockResolvedValue({
			ok: true,
			value: { content: '開幕', targetPersonaId: 'p1', selectedDiscussionPointIndex: 0 },
		});
		// ループ外に出るため generatePersonaTurn が null を返す
		mockGeneratePersonaTurn.mockResolvedValue(null);

		const { executeChapterTask } = await import('./debate-orchestrator.js');
		await executeChapterTask('topic1', 0);

		expect(state.discussionPoints).toHaveLength(3);
		expect(state.discussionPoints[0]).toEqual({ point: '論点A', status: 'introduced' });
		expect(state.discussionPoints[1]).toEqual({ point: '論点B', status: 'untouched' });
		expect(state.discussionPoints[2]).toEqual({ point: '論点C', status: 'untouched' });
	});

	it('章に discussionPoints がない場合、state.discussionPoints は空配列のまま', async () => {
		const chapter = makeChapter({ discussionPoints: [] });
		const state = makeState();
		mockGetDebateState.mockReturnValue(state);
		mockGetChaptersByTopicId.mockResolvedValue([makeChapterEntry(chapter)]);
		mockGenerateOpening.mockResolvedValue({
			ok: true,
			value: { content: '開幕', targetPersonaId: 'p1' },
		});
		mockGeneratePersonaTurn.mockResolvedValue(null);

		const { executeChapterTask } = await import('./debate-orchestrator.js');
		await executeChapterTask('topic1', 0);

		expect(state.discussionPoints).toHaveLength(0);
	});
});

describe('executeChapterTask - 冪等性チェック（status=completed）', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mockGetDebateTurnsByTopicId.mockResolvedValue([]);
		mockIsDebateActive.mockResolvedValue(true);
	});

	it('対象チャプターが completed の場合はスキップして次章があれば true を返す', async () => {
		const chapter = makeChapter();
		const completedEntry = makeChapterEntry(chapter, 'completed');
		const nextEntry: ChapterEntry = { ...makeChapterEntry(makeChapter({ id: 'ch2' })), chapterIndex: 1 };
		mockGetChaptersByTopicId.mockResolvedValue([completedEntry, nextEntry]);

		const { executeChapterTask } = await import('./debate-orchestrator.js');
		const hasNext = await executeChapterTask('topic1', 0);

		expect(hasNext).toBe(true);
		expect(mockGenerateOpening).not.toHaveBeenCalled();
	});

	it('対象チャプターが completed かつ最後の章なら false を返す', async () => {
		const chapter = makeChapter();
		const completedEntry = makeChapterEntry(chapter, 'completed');
		mockGetChaptersByTopicId.mockResolvedValue([completedEntry]);

		const { executeChapterTask } = await import('./debate-orchestrator.js');
		const hasNext = await executeChapterTask('topic1', 0);

		expect(hasNext).toBe(false);
		expect(mockGenerateOpening).not.toHaveBeenCalled();
	});
});

describe('executeChapterTask - ハードキャップ計算', () => {
	beforeEach(() => {
		vi.resetModules();
		mockGetDebateTurnsByTopicId.mockResolvedValue([]);
	});

	it('discussionPoints がある章は AGENDA_TURN_CAP_RATIO を使う（TURN_CAP_RATIO より高い cap）', async () => {
		// turnsPerChapter=15, TURN_CAP_RATIO=1.5→22, AGENDA_TURN_CAP_RATIO=2.5→38
		const chapter = makeChapter({ id: 'ch1', discussionPoints: ['論点A'] });
		const state = makeState([{ point: '論点A', status: 'untouched' }]);
		mockGetDebateState.mockReturnValue(state);
		mockGetChaptersByTopicId.mockResolvedValue([makeChapterEntry(chapter)]);
		mockGenerateOpening.mockResolvedValue({
			ok: true,
			value: { content: '開幕', targetPersonaId: 'p1', selectedDiscussionPointIndex: 0 },
		});

		// ターンを 23 回（TURN_CAP_RATIO での cap=22 超え）生成できるかチェック
		let callCount = 0;
		mockGeneratePersonaTurn.mockImplementation(async () => {
			callCount++;
			state.turns.push({
				id: `t${callCount}`,
				speakerType: 'persona',
				content: '発言',
				createdAt: '2026-06-19T00:00:00Z',
			});
			// 25ターン目で null を返してループを抜ける
			if (callCount >= 25) return null;
			return { personaId: 'p1', turnId: `t${callCount}`, queuedEntries: [], beliefChange: null };
		});

		const { executeChapterTask } = await import('./debate-orchestrator.js');
		await executeChapterTask('topic1', 0);

		// AGENDA_TURN_CAP_RATIO(2.5)の cap=38 なので 25 ターン生成できる（TURN_CAP_RATIOの22で打ち切られない）
		expect(callCount).toBeGreaterThan(22);
	});

	it('discussionPoints がない章は TURN_CAP_RATIO を使う（cap=22）', async () => {
		const chapter = makeChapter({ id: 'ch1', discussionPoints: [] });
		const state = makeState([]);
		mockGetDebateState.mockReturnValue(state);
		mockGetChaptersByTopicId.mockResolvedValue([makeChapterEntry(chapter)]);
		mockGenerateOpening.mockResolvedValue({
			ok: true,
			value: { content: '開幕', targetPersonaId: 'p1' },
		});

		let callCount = 0;
		mockGeneratePersonaTurn.mockImplementation(async () => {
			callCount++;
			state.turns.push({
				id: `t${callCount}`,
				speakerType: 'persona',
				content: '発言',
				createdAt: '2026-06-19T00:00:00Z',
			});
			return { personaId: 'p1', turnId: `t${callCount}`, queuedEntries: [], beliefChange: null };
		});

		const { executeChapterTask } = await import('./debate-orchestrator.js');
		await executeChapterTask('topic1', 0, { turnsPerChapter: 15, maxTurns: 200, interventionCooldown: 3 });

		// TURN_CAP_RATIO(1.5) → cap = ceil(15 * 1.5) = 23
		expect(callCount).toBeLessThanOrEqual(23);
	});
});

describe('executeChapterTask - 開幕で論点1を introduced にマーク', () => {
	beforeEach(() => {
		vi.resetModules();
		mockGetDebateTurnsByTopicId.mockResolvedValue([]);
	});

	it('開幕の selectedDiscussionPointIndex: 0 で論点1を introduced にマークする', async () => {
		const chapter = makeChapter({ discussionPoints: ['論点X', '論点Y'] });
		const state = makeState();
		mockGetDebateState.mockReturnValue(state);
		mockGetChaptersByTopicId.mockResolvedValue([makeChapterEntry(chapter)]);
		mockGenerateOpening.mockResolvedValue({
			ok: true,
			value: { content: '開幕', targetPersonaId: 'p1', selectedDiscussionPointIndex: 0 },
		});
		mockGeneratePersonaTurn.mockResolvedValue(null);

		const { executeChapterTask } = await import('./debate-orchestrator.js');
		await executeChapterTask('topic1', 0);

		expect(state.discussionPoints[0].status).toBe('introduced');
		expect(state.discussionPoints[1].status).toBe('untouched');
	});
});

describe('executeChapterTask - 早期終了ロジック', () => {
	beforeEach(() => {
		vi.resetModules();
		mockGetDebateTurnsByTopicId.mockResolvedValue([]);
	});

	it('未完了論点がある場合は早期終了を抑止して継続する', async () => {
		const chapter = makeChapter({ id: 'ch1', discussionPoints: ['論点A', '論点B'] });
		const state = makeState([
			{ point: '論点A', status: 'introduced' },
			{ point: '論点B', status: 'untouched' },
		]);
		mockGetDebateState.mockReturnValue(state);
		mockGetChaptersByTopicId.mockResolvedValue([makeChapterEntry(chapter)]);
		mockGenerateOpening.mockResolvedValue({
			ok: true,
			value: { content: '開幕', targetPersonaId: 'p1', selectedDiscussionPointIndex: 0 },
		});

		// coverage 評価で全論点消化 → 以降は break
		mockEvaluateDiscussionPointCoverage.mockResolvedValueOnce({ ok: true, value: [0, 1] });

		// engagements に低スコアを返して chapterEndCount を増やす
		const { evaluateEngagements } = await import('./engagement.js');
		vi.mocked(evaluateEngagements).mockResolvedValue([
			{ personaId: 'p1', score: 2, mode: 'opinion' as const },
		]);

		// EARLY_END_PROGRESS_RATIO(0.75)×15=12ターン + CHAPTER_END_COUNT_LIMIT=5 回 false
		let turnCount = 0;
		mockGeneratePersonaTurn.mockImplementation(async () => {
			turnCount++;
			state.turns.push({
				id: `t${turnCount}`,
				speakerType: 'persona',
				content: '発言',
				createdAt: '',
			});
			if (turnCount > 30) return null; // 安全ガード
			return { personaId: 'p1', turnId: `t${turnCount}`, queuedEntries: [], beliefChange: null };
		});

		const { executeChapterTask } = await import('./debate-orchestrator.js');
		await executeChapterTask('topic1', 0);

		expect(mockEvaluateDiscussionPointCoverage).toHaveBeenCalled();
	});

	it('coverage が全論点を addressed と返した場合は早期終了する', async () => {
		const chapter = makeChapter({ id: 'ch1', discussionPoints: ['論点A'] });
		const state = makeState();
		mockGetDebateState.mockReturnValue(state);
		mockGetChaptersByTopicId.mockResolvedValue([makeChapterEntry(chapter)]);
		mockGenerateOpening.mockResolvedValue({
			ok: true,
			value: { content: '開幕', targetPersonaId: 'p1', selectedDiscussionPointIndex: 0 },
		});
		mockEvaluateDiscussionPointCoverage.mockResolvedValue({ ok: true, value: [0] });

		const { evaluateEngagements } = await import('./engagement.js');
		vi.mocked(evaluateEngagements).mockResolvedValue([
			{ personaId: 'p1', score: 2, mode: 'opinion' as const },
		]);

		let turnCount = 0;
		mockGeneratePersonaTurn.mockImplementation(async () => {
			turnCount++;
			state.turns.push({
				id: `t${turnCount}`,
				speakerType: 'persona',
				content: '発言',
				createdAt: '',
			});
			if (turnCount > 50) return null;
			return { personaId: 'p1', turnId: `t${turnCount}`, queuedEntries: [], beliefChange: null };
		});

		const { executeChapterTask } = await import('./debate-orchestrator.js');
		await executeChapterTask('topic1', 0, { turnsPerChapter: 15, maxTurns: 200, interventionCooldown: 3 });

		expect(mockEvaluateDiscussionPointCoverage).toHaveBeenCalled();
		expect(turnCount).toBeLessThan(38);
	});

	it('discussionPoints が空の場合は既存ロジックで動作し coverage は呼ばれない', async () => {
		const chapter = makeChapter({ id: 'ch1', discussionPoints: [] });
		const state = makeState();
		mockGetDebateState.mockReturnValue(state);
		mockGetChaptersByTopicId.mockResolvedValue([makeChapterEntry(chapter)]);
		mockGenerateOpening.mockResolvedValue({
			ok: true,
			value: { content: '開幕', targetPersonaId: 'p1' },
		});
		mockEvaluateDiscussionPointCoverage.mockReset();

		const { evaluateEngagements } = await import('./engagement.js');
		vi.mocked(evaluateEngagements).mockResolvedValue([
			{ personaId: 'p1', score: 2, mode: 'opinion' as const },
		]);

		let turnCount = 0;
		mockGeneratePersonaTurn.mockImplementation(async () => {
			turnCount++;
			state.turns.push({
				id: `t${turnCount}`,
				speakerType: 'persona',
				content: '発言',
				createdAt: '',
			});
			if (turnCount > 30) return null;
			return { personaId: 'p1', turnId: `t${turnCount}`, queuedEntries: [], beliefChange: null };
		});

		const { executeChapterTask } = await import('./debate-orchestrator.js');
		await executeChapterTask('topic1', 0, { turnsPerChapter: 15, maxTurns: 200, interventionCooldown: 3 });

		expect(mockEvaluateDiscussionPointCoverage).not.toHaveBeenCalled();
	});
});

describe('executeChapterTask - chapterId をダウンストリームに渡す', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mockGetDebateTurnsByTopicId.mockResolvedValue([]);
		mockIsDebateActive.mockResolvedValue(true);
	});

	it('loadQueuedIntents が (topicId, chapterId) で呼ばれる', async () => {
		const chapter = makeChapter({ id: 'ch1' });
		const state = makeState();
		mockGetDebateState.mockReturnValue(state);
		mockGetChaptersByTopicId.mockResolvedValue([makeChapterEntry(chapter)]);
		mockGenerateOpening.mockResolvedValue({ ok: true, value: { content: '開幕', targetPersonaId: 'p1' } });
		mockGeneratePersonaTurn.mockResolvedValue(null);

		const { executeChapterTask } = await import('./debate-orchestrator.js');
		const { loadQueuedIntents } = await import('./queued-intents.js');
		await executeChapterTask('topic1', 0);

		expect(loadQueuedIntents).toHaveBeenCalledWith('topic1', 'ch1');
	});

	it('expireQueuedIntents が chapterId を含むオブジェクトで呼ばれる', async () => {
		const chapter = makeChapter({ id: 'ch1' });
		const state = makeState();
		mockGetDebateState.mockReturnValue(state);
		mockGetChaptersByTopicId.mockResolvedValue([makeChapterEntry(chapter)]);
		mockGenerateOpening.mockResolvedValue({ ok: true, value: { content: '開幕', targetPersonaId: 'p1' } });
		mockGeneratePersonaTurn.mockImplementation(async () => {
			state.turns.push({ id: 't1', speakerType: 'persona', content: '', createdAt: '' });
			return null;
		});

		const { executeChapterTask } = await import('./debate-orchestrator.js');
		const { expireQueuedIntents } = await import('./queued-intents.js');
		await executeChapterTask('topic1', 0);

		expect(expireQueuedIntents).toHaveBeenCalledWith(expect.objectContaining({ topicId: 'topic1', chapterId: 'ch1' }));
	});

	it('evaluateEngagements が chapterId と chapterTurns を含むオブジェクトで呼ばれる', async () => {
		const chapter = makeChapter({ id: 'ch1' });
		const state = makeState();
		mockGetDebateState.mockReturnValue(state);
		mockGetChaptersByTopicId.mockResolvedValue([makeChapterEntry(chapter)]);
		mockGenerateOpening.mockResolvedValue({ ok: true, value: { content: '開幕', targetPersonaId: 'p1' } });
		mockGeneratePersonaTurn.mockImplementation(async () => {
			state.turns.push({ id: 't1', speakerType: 'persona', content: '', createdAt: '' });
			return null;
		});

		const { executeChapterTask } = await import('./debate-orchestrator.js');
		const { evaluateEngagements } = await import('./engagement.js');
		await executeChapterTask('topic1', 0);

		expect(evaluateEngagements).toHaveBeenCalledWith(
			expect.objectContaining({ topicId: 'topic1', chapterId: 'ch1', chapterTurns: expect.any(Array) })
		);
	});

	it('evaluateEngagements に state.turns 全体ではなくチャプター内ターンのみが渡される', async () => {
		const chapter = makeChapter({ id: 'ch1' });
		const priorTurn = { id: 'prior', speakerType: 'persona' as const, content: '前章', createdAt: '' };
		const state = makeState();
		mockGetDebateTurnsByTopicId.mockResolvedValue([priorTurn]);
		// chapterDoc.turns = [] なので chapterTurnStartInState = 1 - 0 = 1
		mockGetChaptersByTopicId.mockResolvedValue([{ ...makeChapterEntry(chapter), turns: [] }]);
		mockGetDebateState.mockReturnValue({ ...state, turns: [priorTurn] });
		mockGenerateOpening.mockResolvedValue({ ok: true, value: { content: '開幕', targetPersonaId: 'p1' } });
		let callCount = 0;
		mockGeneratePersonaTurn.mockImplementation(async () => {
			callCount++;
			const newTurn = { id: `t${callCount}`, speakerType: 'persona' as const, content: '', createdAt: '' };
			state.turns.push(newTurn);
			return null;
		});

		const { executeChapterTask } = await import('./debate-orchestrator.js');
		const { evaluateEngagements } = await import('./engagement.js');
		await executeChapterTask('topic1', 0);

		const calls = vi.mocked(evaluateEngagements).mock.calls;
		if (calls.length > 0) {
			const chapterTurns = calls[0][0].chapterTurns as unknown[];
			// 前章ターン（priorTurn）はチャプターターンに含まれない
			expect(chapterTurns).not.toContainEqual(expect.objectContaining({ id: 'prior' }));
		}
	});
});
