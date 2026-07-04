import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Persona } from '../../../types/persona.types.js';
import type { DebateState } from '../../../types/debate.types.js';
import type { DebateTurn } from '../../../types/turn.types.js';

const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue({ update: mockUpdate, set: mockSet });

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc })),
	Timestamp: { now: vi.fn(() => ({ toDate: () => new Date() })) },
	FieldValue: { arrayUnion: vi.fn((...args: unknown[]) => args) }
}));

const mockEvaluateEngagement = vi.fn();
vi.mock('../../../agents/persona-agent.js', () => ({
	evaluateEngagement: (...args: unknown[]) => mockEvaluateEngagement(...args)
}));

const mockAppendAwareness = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../pipeline/debate/awareness.js', () => ({
	appendAwareness: (...args: unknown[]) => mockAppendAwareness(...args)
}));

import {
	evaluateEngagements,
	evaluateEngagementWithFallback
} from '../../../pipeline/debate/engagement.js';

const makePersona = (id: string, name: string): Persona => ({
	id,
	topicId: 'topic1',
	name,
	age: 30,
	occupation: '会社員',
	stakeholderRole: '市民',
	specificRole: '市民',
	background: '背景',
	interests: '関心',
	nationality: '日本',
	engagementLevel: 'moderate',
	llmType: 'claude',
	approved: true,
	sortOrder: 0
});

const makeState = (overrides?: Partial<DebateState>): DebateState => ({
	turns: [],
	lastSpeakerId: undefined,
	silenceMap: new Map(),
	speakCount: new Map(),
	queuedIntents: new Map(),
	discussionPoints: [],
	...overrides
});

const makeDebateTurn = (id: string): DebateTurn => ({
	id,
	speakerType: 'persona',
	personaId: 'p1',
	content: '発言内容',
	speechMode: 'opinion',
	createdAt: ''
});

describe('evaluateEngagements', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateEngagement.mockResolvedValue({ personaId: 'p1', score: 3, mode: 'opinion' });
	});

	it('各ペルソナの評価に otherPersonaNames（自分以外の名前リスト）を渡す', async () => {
		const personas = [
			makePersona('p1', '田中太郎'),
			makePersona('p2', '佐藤花子'),
			makePersona('p3', '鈴木次郎')
		];
		const state = makeState();
		const chapterTurns: DebateTurn[] = [];

		await evaluateEngagements({
			topicId: 'topic1',
			chapterId: 'ch1',
			personas,
			state,
			chapterTurns
		});

		// p1 の評価には p2, p3 の名前が渡る
		const p1Call = mockEvaluateEngagement.mock.calls.find(
			(call: unknown[]) => (call[0] as Persona).id === 'p1'
		);
		expect(p1Call).toBeDefined();
		expect(p1Call![2]).toEqual(expect.arrayContaining(['佐藤花子', '鈴木次郎']));
		expect(p1Call![2]).not.toContain('田中太郎');

		// p2 の評価には p1, p3 の名前が渡る
		const p2Call = mockEvaluateEngagement.mock.calls.find(
			(call: unknown[]) => (call[0] as Persona).id === 'p2'
		);
		expect(p2Call).toBeDefined();
		expect(p2Call![2]).toEqual(expect.arrayContaining(['田中太郎', '鈴木次郎']));
		expect(p2Call![2]).not.toContain('佐藤花子');
	});

	it('lastSpeakerId のペルソナは評価対象から除外される', async () => {
		const personas = [makePersona('p1', '田中太郎'), makePersona('p2', '佐藤花子')];
		const state = makeState({ lastSpeakerId: 'p1' });
		const chapterTurns: DebateTurn[] = [];

		await evaluateEngagements({
			topicId: 'topic1',
			chapterId: 'ch1',
			personas,
			state,
			chapterTurns
		});

		const calledIds = mockEvaluateEngagement.mock.calls.map(
			(call: unknown[]) => (call[0] as Persona).id
		);
		expect(calledIds).not.toContain('p1');
		expect(calledIds).toContain('p2');
	});

	it('evaluateEngagement に state.turns ではなく chapterTurns を渡す', async () => {
		const personas = [makePersona('p1', '田中太郎'), makePersona('p2', '佐藤花子')];
		const stateTurn = makeDebateTurn('state-turn');
		const chapterTurn = makeDebateTurn('chapter-turn');
		const state = makeState({ turns: [stateTurn] });
		const chapterTurns: DebateTurn[] = [chapterTurn];

		await evaluateEngagements({
			topicId: 'topic1',
			chapterId: 'ch1',
			personas,
			state,
			chapterTurns
		});

		const calls = mockEvaluateEngagement.mock.calls;
		for (const call of calls) {
			const turns = call[1] as DebateTurn[];
			expect(turns).toContain(chapterTurn);
			expect(turns).not.toContain(stateTurn);
		}
	});

	it('saveEngagements の書き込み先が chapters/{chapterId}/engagements/{personaId} になる', async () => {
		const personas = [makePersona('p1', '田中太郎')];
		const state = makeState({ turns: [makeDebateTurn('t1')] });
		const chapterTurns: DebateTurn[] = [makeDebateTurn('t1')];

		await evaluateEngagements({
			topicId: 'topic1',
			chapterId: 'ch1',
			personas,
			state,
			chapterTurns
		});

		const docPaths = mockDoc.mock.calls.map((call: string[]) => call[0]);
		expect(docPaths.some((p: string) => p === 'topics/topic1/chapters/ch1/engagements/p1')).toBe(
			true
		);
		expect(docPaths.some((p: string) => p.includes('topics/topic1/engagements'))).toBe(false);
	});

	it('傾聴で気づきを検出したペルソナについて、当該ターンidで appendAwareness を呼ぶ（話者選択前）', async () => {
		const personas = [makePersona('p1', '田中太郎'), makePersona('p2', '佐藤花子')];
		const awareness = { kind: 'reception', content: '一理ある', sourcePersonaId: 'p2' };
		mockEvaluateEngagement.mockImplementation(async (p: Persona) =>
			p.id === 'p1'
				? { personaId: 'p1', score: 3, mode: 'opinion', awareness }
				: { personaId: 'p2', score: 2, mode: 'opinion', awareness: null }
		);
		const state = makeState({ turns: [makeDebateTurn('t1')] });

		await evaluateEngagements({
			topicId: 'topic1',
			chapterId: 'ch1',
			personas,
			state,
			chapterTurns: [makeDebateTurn('t1')]
		});

		expect(mockAppendAwareness).toHaveBeenCalledTimes(1);
		const arg = mockAppendAwareness.mock.calls[0][0];
		expect(arg.topicId).toBe('topic1');
		expect(arg.persona.id).toBe('p1');
		expect(arg.turnId).toBe('t1');
		expect(arg.awareness).toEqual(awareness);
	});

	it('awareness が null のペルソナには appendAwareness を呼ばない', async () => {
		const personas = [makePersona('p1', '田中太郎')];
		mockEvaluateEngagement.mockResolvedValue({
			personaId: 'p1',
			score: 3,
			mode: 'opinion',
			awareness: null
		});

		await evaluateEngagements({
			topicId: 'topic1',
			chapterId: 'ch1',
			personas,
			state: makeState({ turns: [makeDebateTurn('t1')] }),
			chapterTurns: [makeDebateTurn('t1')]
		});

		expect(mockAppendAwareness).not.toHaveBeenCalled();
	});

	it('appendAwareness が失敗しても評価結果を返す（best-effort）', async () => {
		const personas = [makePersona('p1', '田中太郎')];
		mockEvaluateEngagement.mockResolvedValue({
			personaId: 'p1',
			score: 3,
			mode: 'opinion',
			awareness: { kind: 'self', content: '気づき', sourcePersonaId: null }
		});
		mockAppendAwareness.mockRejectedValueOnce(new Error('firestore down'));
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await evaluateEngagements({
			topicId: 'topic1',
			chapterId: 'ch1',
			personas,
			state: makeState({ turns: [makeDebateTurn('t1')] }),
			chapterTurns: [makeDebateTurn('t1')]
		});

		expect(result).toHaveLength(1);
		expect(result[0].personaId).toBe('p1');
	});
});

describe('evaluateEngagementWithFallback', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('engagement リストにない場合は evaluateEngagement に otherPersonaNames を渡す', async () => {
		mockEvaluateEngagement.mockResolvedValue({
			personaId: 'p1',
			score: 3,
			mode: 'opinion'
		});
		const personas = [
			makePersona('p1', '田中太郎'),
			makePersona('p2', '佐藤花子'),
			makePersona('p3', '鈴木次郎')
		];

		await evaluateEngagementWithFallback({
			topicId: 'topic1',
			personaId: 'p1',
			personas,
			chapterTurns: [],
			engagements: []
		});

		expect(mockEvaluateEngagement).toHaveBeenCalledOnce();
		const callArgs = mockEvaluateEngagement.mock.calls[0];
		expect(callArgs[2]).toEqual(expect.arrayContaining(['佐藤花子', '鈴木次郎']));
		expect(callArgs[2]).not.toContain('田中太郎');
	});

	it('engagement リストにある場合は evaluateEngagement を呼ばずにそのまま返す', async () => {
		const personas = [makePersona('p1', '田中太郎'), makePersona('p2', '佐藤花子')];
		const existingEngagement = {
			personaId: 'p1',
			score: 4,
			mode: 'question' as const,
			intentSummary: '聞きたい'
		};

		const result = await evaluateEngagementWithFallback({
			topicId: 'topic1',
			personaId: 'p1',
			personas,
			chapterTurns: [],
			engagements: [existingEngagement]
		});

		expect(mockEvaluateEngagement).not.toHaveBeenCalled();
		expect(result).toEqual(existingEngagement);
	});

	it('フォールバック評価で検出した気づきを appendAwareness で永続する', async () => {
		mockEvaluateEngagement.mockResolvedValue({
			personaId: 'p1',
			score: 3,
			mode: 'opinion',
			awareness: { kind: 'self', content: '気づき', sourcePersonaId: null }
		});
		const personas = [makePersona('p1', '田中太郎'), makePersona('p2', '佐藤花子')];

		await evaluateEngagementWithFallback({
			topicId: 'topic1',
			personaId: 'p1',
			personas,
			chapterTurns: [makeDebateTurn('t1')],
			engagements: []
		});

		expect(mockAppendAwareness).toHaveBeenCalledTimes(1);
		expect(mockAppendAwareness.mock.calls[0][0].turnId).toBe('t1');
	});

	it('リストにある場合は appendAwareness を呼ばない（evaluateEngagements で永続済み・二重永続しない）', async () => {
		const personas = [makePersona('p1', '田中太郎')];

		await evaluateEngagementWithFallback({
			topicId: 'topic1',
			personaId: 'p1',
			personas,
			chapterTurns: [makeDebateTurn('t1')],
			engagements: [
				{
					personaId: 'p1',
					score: 4,
					mode: 'opinion',
					awareness: { kind: 'self', content: 'x', sourcePersonaId: null }
				}
			]
		});

		expect(mockAppendAwareness).not.toHaveBeenCalled();
	});
});
