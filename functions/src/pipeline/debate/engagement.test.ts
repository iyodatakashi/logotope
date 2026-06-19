import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Persona } from '../../types/persona.types.js';
import type { DebateState } from '../../types/debate.types.js';

const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue({ update: mockUpdate, set: mockSet });

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc })),
	Timestamp: { now: vi.fn(() => ({ toDate: () => new Date() })) },
	FieldValue: { arrayUnion: vi.fn((...args: unknown[]) => args) },
}));

const mockEvaluateEngagement = vi.fn();
vi.mock('../../agents/persona-agent.js', () => ({
	evaluateEngagement: (...args: unknown[]) => mockEvaluateEngagement(...args),
}));

import { evaluateEngagements, evaluateEngagementWithFallback } from './engagement.js';

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
	sortOrder: 0,
});

const makeState = (overrides?: Partial<DebateState>): DebateState => ({
	turns: [],
	lastSpeakerId: undefined,
	silenceMap: new Map(),
	speakCount: new Map(),
	queuedIntents: new Map(),
	pairConversationTurns: 0,
	currentTurnIndex: 0,
	lastFacilitatorTurnIndex: -1,
	...overrides,
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
			makePersona('p3', '鈴木次郎'),
		];
		const state = makeState();

		await evaluateEngagements({ topicId: 'topic1', personas, state });

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

		await evaluateEngagements({ topicId: 'topic1', personas, state });

		const calledIds = mockEvaluateEngagement.mock.calls.map(
			(call: unknown[]) => (call[0] as Persona).id
		);
		expect(calledIds).not.toContain('p1');
		expect(calledIds).toContain('p2');
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
			mode: 'opinion',
		});
		const personas = [
			makePersona('p1', '田中太郎'),
			makePersona('p2', '佐藤花子'),
			makePersona('p3', '鈴木次郎'),
		];

		await evaluateEngagementWithFallback({
			personaId: 'p1',
			personas,
			turns: [],
			engagements: [],
		});

		expect(mockEvaluateEngagement).toHaveBeenCalledOnce();
		const callArgs = mockEvaluateEngagement.mock.calls[0];
		expect(callArgs[2]).toEqual(expect.arrayContaining(['佐藤花子', '鈴木次郎']));
		expect(callArgs[2]).not.toContain('田中太郎');
	});

	it('engagement リストにある場合は evaluateEngagement を呼ばずにそのまま返す', async () => {
		const personas = [makePersona('p1', '田中太郎'), makePersona('p2', '佐藤花子')];
		const existingEngagement = { personaId: 'p1', score: 4, mode: 'question' as const, intentSummary: '聞きたい' };

		const result = await evaluateEngagementWithFallback({
			personaId: 'p1',
			personas,
			turns: [],
			engagements: [existingEngagement],
		});

		expect(mockEvaluateEngagement).not.toHaveBeenCalled();
		expect(result).toEqual(existingEngagement);
	});
});
