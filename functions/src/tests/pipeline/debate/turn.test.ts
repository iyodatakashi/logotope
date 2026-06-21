import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Persona } from '../../../types/persona.types.js';
import type { Engagement, SpeakerSelection } from '../../../types/debate.types.js';
import type { Chapter } from '../../../types/chapter.types.js';

const mockGet = vi.fn().mockResolvedValue({
	exists: true,
	data: () => ({ phase: 5, phaseStatus: 'running' })
});
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue({ get: mockGet, update: mockUpdate });

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc })),
	Timestamp: { now: vi.fn(() => 'mock-timestamp') },
	FieldValue: { arrayUnion: vi.fn((...args: unknown[]) => args[0]) }
}));

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'mock-turn-id') }));

const mockGenerateTurn = vi.fn();
vi.mock('../../../agents/persona-agent.js', () => ({
	generateTurn: (...args: unknown[]) => mockGenerateTurn(...args),
	generatePostDebateComment: vi.fn()
}));

vi.mock('../../../agents/facilitator-agent.js', () => ({
	generateChapterSummary: vi.fn(),
	generateClosing: vi.fn()
}));

const mockValidPersonaId = vi.fn((id: string | undefined) => id);
vi.mock('../../../pipeline/debate/utils.js', () => ({
	pipelineErrorMessage: vi.fn((e: unknown) => String(e)),
	validPersonaId: (id: string | undefined, _personas: unknown[]) => mockValidPersonaId(id)
}));

import { generatePersonaTurn } from '../../../pipeline/debate/turn.js';

const makePersona = (id: string, name: string): Persona => ({
	id,
	topicId: 'topic1',
	name,
	age: 35,
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

const makeEngagement = (override?: Partial<Engagement>): Engagement => ({
	personaId: 'p1',
	score: 4,
	mode: 'question',
	intentSummary: '佐藤さんの意見を聞きたい',
	...override
});

const makeSpeakerSelection = (override?: Partial<SpeakerSelection>): SpeakerSelection => ({
	personaId: 'p1',
	reason: 'score',
	...override
});

const mockChapter: Chapter = { id: 'ch1', title: 'テスト章', focusQuestion: 'テスト？' };

const makeDebateState = () => ({
	turns: [],
	lastSpeakerId: undefined,
	silenceMap: new Map(),
	speakCount: new Map(),
	queuedIntents: new Map(),
	discussionPoints: []
});

const makeDebateTurn = (
	override: Partial<{
		id: string;
		speakerType: string;
		personaId: string | null;
		content: string;
		createdAt: string;
	}> = {}
) => ({
	id: 't0',
	speakerType: 'persona' as const,
	personaId: 'p2',
	content: '佐藤の発言',
	createdAt: '',
	...override
});

describe('generatePersonaTurn', () => {
	const personas = [
		makePersona('p1', '田中太郎'),
		makePersona('p2', '佐藤花子'),
		makePersona('p3', '鈴木次郎')
	];

	beforeEach(() => {
		vi.clearAllMocks();
		mockGet.mockResolvedValue({
			exists: true,
			data: () => ({ phase: 5, phaseStatus: 'running' })
		});
		mockUpdate.mockResolvedValue(undefined);
		mockDoc.mockReturnValue({ get: mockGet, update: mockUpdate });
		mockValidPersonaId.mockImplementation((id: string | undefined) => id);
	});

	it('generateTurn に otherPersonas（発言者を除く）を渡す', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: 'テスト発言', speechMode: 'opinion', beliefChange: null }
		});

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion', intentSummary: '意見' })
		});

		expect(mockGenerateTurn).toHaveBeenCalledOnce();
		const callArgs = mockGenerateTurn.mock.calls[0];
		const context = callArgs[1];
		expect(context.otherPersonas).toBeDefined();
		expect(context.otherPersonas).toHaveLength(2);
		expect(context.otherPersonas).toEqual(
			expect.arrayContaining([
				{ id: 'p2', name: '佐藤花子' },
				{ id: 'p3', name: '鈴木次郎' }
			])
		);
		// 発言者自身は含まれない
		expect(context.otherPersonas.map((p: { id: string }) => p.id)).not.toContain('p1');
	});

	it('question モードかつ targetPersonaId が設定された場合、speechMode: question でターンを保存する', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: {
				content: '質問発言',
				speechMode: 'question',
				beliefChange: null,
				targetPersonaId: 'p2'
			}
		});
		mockValidPersonaId.mockReturnValue('p2');

		const state = makeDebateState();
		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state,
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement()
		});

		const updateCall = mockUpdate.mock.calls.find((call: unknown[]) => {
			const arg = call[0] as { turns?: unknown };
			return arg.turns !== undefined;
		});
		expect(updateCall).toBeDefined();
		const savedTurn = (updateCall![0] as { turns: { speechMode?: string } }).turns;
		expect(savedTurn.speechMode).toBe('question');
	});

	it('question モードかつ targetPersonaId が未設定の場合、speechMode: opinion にフォールバックして保存する', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: {
				content: '質問発言',
				speechMode: 'question',
				beliefChange: null,
				targetPersonaId: undefined
			}
		});
		mockValidPersonaId.mockReturnValue(undefined);

		const state = makeDebateState();
		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state,
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement()
		});

		const updateCall = mockUpdate.mock.calls.find((call: unknown[]) => {
			const arg = call[0] as { turns?: unknown };
			return arg.turns !== undefined;
		});
		expect(updateCall).toBeDefined();
		const savedTurn = (updateCall![0] as { turns: { speechMode?: string } }).turns;
		expect(savedTurn.speechMode).toBe('opinion');
	});

	it('opinion モードは speechMode: opinion のままターンを保存する', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '意見発言', speechMode: 'opinion', beliefChange: null }
		});

		const state = makeDebateState();
		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state,
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion', intentSummary: '意見' })
		});

		const updateCall = mockUpdate.mock.calls.find((call: unknown[]) => {
			const arg = call[0] as { turns?: unknown };
			return arg.turns !== undefined;
		});
		const savedTurn = (updateCall![0] as { turns: { speechMode?: string } }).turns;
		expect(savedTurn.speechMode).toBe('opinion');
	});

	it('Firestoreに書き込むターンに speakerName/speakerRole が含まれない', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '意見発言', speechMode: 'opinion', beliefChange: null }
		});

		const state = makeDebateState();
		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state,
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		const updateCall = mockUpdate.mock.calls.find((call: unknown[]) => {
			const arg = call[0] as { turns?: unknown };
			return arg.turns !== undefined;
		});
		expect(updateCall).toBeDefined();
		const savedTurn = updateCall![0] as { turns: Record<string, unknown> };
		expect(savedTurn.turns.speakerName).toBeUndefined();
		expect(savedTurn.turns.speakerRole).toBeUndefined();
	});

	it('state.turns に push されるターンに speakerName/speakerRole が含まれない', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '意見発言', speechMode: 'opinion', beliefChange: null }
		});

		const state = makeDebateState();
		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state,
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		expect(state.turns).toHaveLength(1);
		const pushedTurn = state.turns[0] as Record<string, unknown>;
		expect(pushedTurn.speakerName).toBeUndefined();
		expect(pushedTurn.speakerRole).toBeUndefined();
	});

	it('queuedTrigger の speakerName は personas 配列から personaId で解決する', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '意見発言', speechMode: 'opinion', beliefChange: null }
		});

		const state = makeDebateState();
		state.turns.push(makeDebateTurn({ id: 't0', personaId: 'p2' }));
		state.queuedIntents.set('p1', [{ triggerTurnId: 't0', intentSummary: '言いたいこと' }]);

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state,
			speakerSelection: makeSpeakerSelection({ personaId: 'p1' }),
			engagement: makeEngagement({ personaId: 'p1', mode: 'opinion' })
		});

		const callArgs = mockGenerateTurn.mock.calls[0];
		const context = callArgs[1];
		expect(context.queuedTrigger).toBeDefined();
		expect(context.queuedTrigger.speakerName).toBe('佐藤花子');
	});

	it('queuedTrigger のトリガーターンが personaId を持たない場合 speakerName は ファシリテーター になる', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '意見発言', speechMode: 'opinion', beliefChange: null }
		});

		const state = makeDebateState();
		state.turns.push(makeDebateTurn({ id: 'f0', speakerType: 'facilitator', personaId: null }));
		state.queuedIntents.set('p1', [{ triggerTurnId: 'f0', intentSummary: 'ファシリ発言への反応' }]);

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state,
			speakerSelection: makeSpeakerSelection({ personaId: 'p1' }),
			engagement: makeEngagement({ personaId: 'p1', mode: 'opinion' })
		});

		const callArgs = mockGenerateTurn.mock.calls[0];
		const context = callArgs[1];
		expect(context.queuedTrigger).toBeDefined();
		expect(context.queuedTrigger.speakerName).toBe('ファシリテーター');
	});

	it('Firestoreへの書き込みは sessions/0 ではなく chapters/{chapterId} に行われる', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '意見発言', speechMode: 'opinion', beliefChange: null }
		});

		const state = makeDebateState();
		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter, // id: 'ch1'
			state,
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		const docPaths = mockDoc.mock.calls.map((call: string[]) => call[0]);
		expect(docPaths.some((p: string) => p.includes('chapters/ch1'))).toBe(true);
		expect(docPaths.some((p: string) => p.includes('sessions'))).toBe(false);
	});

	it('Firestoreに保存されるターンオブジェクトに chapterId が含まれない', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '意見発言', speechMode: 'opinion', beliefChange: null }
		});

		const state = makeDebateState();
		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state,
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		const updateCall = mockUpdate.mock.calls.find((call: unknown[]) => {
			const arg = call[0] as { turns?: unknown };
			return arg.turns !== undefined;
		});
		expect(updateCall).toBeDefined();
		const savedTurn = updateCall![0] as { turns: Record<string, unknown> };
		expect(savedTurn.turns.chapterId).toBeUndefined();
	});

	it('state.turns に push されるターンに chapterId が含まれない', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '意見発言', speechMode: 'opinion', beliefChange: null }
		});

		const state = makeDebateState();
		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state,
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		expect(state.turns).toHaveLength(1);
		const pushedTurn = state.turns[0] as Record<string, unknown>;
		expect(pushedTurn.chapterId).toBeUndefined();
	});
});
