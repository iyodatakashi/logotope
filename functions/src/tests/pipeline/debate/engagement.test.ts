import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Persona } from '../../../types/persona.types.js';
import type { DebateState } from '../../../types/debate.types.js';
import type { DebateTurn } from '../../../types/turn.types.js';

const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockResolvedValue(undefined);
// personaId -> 永続済み history マップ（同一 turnId 再利用テスト用）。既定は空＝未永続（＝評価する）
let mockHistoryByPersona: Record<string, Record<string, unknown>> = {};
const mockDoc = vi.fn((path: string) => {
	const personaId = path.split('/').pop() ?? '';
	return {
		path,
		update: mockUpdate,
		set: mockSet,
		get: vi.fn().mockResolvedValue({
			get: (field: string) => (field === 'history' ? mockHistoryByPersona[personaId] : undefined)
		})
	};
});

// status 解除トランザクション（末尾評価）の get/update 制御
const mockTxGet = vi.fn();
const mockTxUpdate = vi.fn();
const mockRunTransaction = vi.fn(
	async (fn: (tx: { get: typeof mockTxGet; update: typeof mockTxUpdate }) => Promise<unknown>) =>
		fn({ get: mockTxGet, update: mockTxUpdate })
);

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc, runTransaction: mockRunTransaction })),
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
	evaluateEngagementWithFallback,
	evaluateReactionsForCommittedTurn
} from '../../../pipeline/debate/engagement.js';

// 末尾評価の status 解除トランザクション get の制御変数
let txChapterTurns: DebateTurn[] = [];
let txTopicRunId: string | undefined = undefined;

const setupTxDocs = () => {
	mockTxGet.mockImplementation(async (ref: { path: string }) => {
		if (ref.path.includes('/chapters/')) {
			return { data: () => ({ turns: txChapterTurns }) };
		}
		return { data: () => ({ runId: txTopicRunId }) };
	});
};

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
	approved: true,
	sortOrder: 0
});

const makeState = (overrides?: Partial<DebateState>): DebateState => ({
	turns: [],
	lastSpeakerId: undefined,
	silenceMap: new Map(),
	speakCount: new Map(),
	queuedIntents: new Map(),
	agenda: [],
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
		mockHistoryByPersona = {};
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

	it('一括評価では直前話者が対象外のまま、リスナーの気づきのみが永続される（2.2）', async () => {
		const personas = [makePersona('p1', '田中太郎'), makePersona('p2', '佐藤花子')];
		// 直前話者は p2。p2 は評価対象外（気づきも生じない）、リスナー p1 の気づきのみ永続される想定
		const listenerAwareness = {
			kind: 'reception',
			content: '直前への気づき',
			sourcePersonaId: 'p2'
		};
		mockEvaluateEngagement.mockImplementation(async (p: Persona) =>
			p.id === 'p1'
				? { personaId: 'p1', score: 3, mode: 'opinion', awareness: listenerAwareness }
				: { personaId: 'p2', score: 2, mode: 'opinion', awareness: null }
		);
		const state = makeState({ turns: [makeDebateTurn('t1')], lastSpeakerId: 'p2' });

		await evaluateEngagements({
			topicId: 'topic1',
			chapterId: 'ch1',
			personas,
			state,
			chapterTurns: [makeDebateTurn('t1')]
		});

		// 直前話者 p2 は評価対象から除外される
		const calledIds = mockEvaluateEngagement.mock.calls.map(
			(call: unknown[]) => (call[0] as Persona).id
		);
		expect(calledIds).not.toContain('p2');
		expect(calledIds).toContain('p1');
		// 永続はリスナー p1 の気づき1件のみ
		expect(mockAppendAwareness).toHaveBeenCalledTimes(1);
		const arg = mockAppendAwareness.mock.calls[0][0];
		expect(arg.persona.id).toBe('p1');
		expect(arg.awareness).toEqual(listenerAwareness);
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

	it('同一 turnId で既に永続済みのペルソナは再評価せず永続値（score/mode/intentSummary）を再利用する（2.2）', async () => {
		const personas = [makePersona('p1', '田中太郎'), makePersona('p2', '佐藤花子')];
		// p1 は turnId t1 で永続済み → 再利用。p2 は未永続 → 評価する。
		mockHistoryByPersona = {
			p1: { t1: { score: 4, mode: 'opinion', intentSummary: '前回の意図' } }
		};

		const result = await evaluateEngagements({
			topicId: 'topic1',
			chapterId: 'ch1',
			personas,
			state: makeState({ turns: [makeDebateTurn('t1')] }),
			chapterTurns: [makeDebateTurn('t1')]
		});

		const evaluatedIds = mockEvaluateEngagement.mock.calls.map(
			(call: unknown[]) => (call[0] as Persona).id
		);
		expect(evaluatedIds).not.toContain('p1'); // 再利用（LLM 呼び出しなし）
		expect(evaluatedIds).toContain('p2'); // 未永続は従来どおり評価
		const p1 = result.find((r) => r.personaId === 'p1')!;
		expect(p1.score).toBe(4);
		expect(p1.mode).toBe('opinion');
		expect(p1.intentSummary).toBe('前回の意図');
	});

	it('再利用時は気づきを再検出しない（appendAwareness を呼ばない）（2.2）', async () => {
		const personas = [makePersona('p1', '田中太郎')];
		mockHistoryByPersona = { p1: { t1: { score: 3, mode: 'opinion' } } };

		await evaluateEngagements({
			topicId: 'topic1',
			chapterId: 'ch1',
			personas,
			state: makeState({ turns: [makeDebateTurn('t1')] }),
			chapterTurns: [makeDebateTurn('t1')]
		});

		expect(mockEvaluateEngagement).not.toHaveBeenCalled();
		expect(mockAppendAwareness).not.toHaveBeenCalled();
	});

	it('永続値が再利用に不十分（question で intentSummary 欠落）なら従来評価にフォールバックする（2.2）', async () => {
		const personas = [makePersona('p1', '田中太郎')];
		mockHistoryByPersona = { p1: { t1: { score: 4, mode: 'question' } } }; // intentSummary 欠落

		await evaluateEngagements({
			topicId: 'topic1',
			chapterId: 'ch1',
			personas,
			state: makeState({ turns: [makeDebateTurn('t1')] }),
			chapterTurns: [makeDebateTurn('t1')]
		});

		const evaluatedIds = mockEvaluateEngagement.mock.calls.map(
			(call: unknown[]) => (call[0] as Persona).id
		);
		expect(evaluatedIds).toContain('p1'); // 不十分 → フォールバック評価
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

describe('evaluateReactionsForCommittedTurn（末尾評価・コミット済みターンへの反応と status 終了）', () => {
	const evaluatingTurn = (id: string): DebateTurn => ({
		...makeDebateTurn(id),
		status: 'evaluating'
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mockHistoryByPersona = {};
		txChapterTurns = [];
		txTopicRunId = undefined;
		setupTxDocs();
		mockEvaluateEngagement.mockResolvedValue({ personaId: 'p1', score: 3, mode: 'opinion' });
	});

	it('末尾ターンの全非話者を評価し committedTurnId で永続する（話者本人は反応対象外・1.1/1.2）', async () => {
		const personas = [
			makePersona('p1', '田中太郎'),
			makePersona('p2', '佐藤花子'),
			makePersona('p3', '鈴木次郎')
		];
		txChapterTurns = [evaluatingTurn('t1')]; // 話者は p1（makeDebateTurn の personaId）

		await evaluateReactionsForCommittedTurn({
			topicId: 'topic1',
			chapterId: 'ch1',
			committedTurnId: 't1',
			personas,
			chapterTurns: [makeDebateTurn('t1')]
		});

		const evaluatedIds = mockEvaluateEngagement.mock.calls.map(
			(call: unknown[]) => (call[0] as Persona).id
		);
		expect(evaluatedIds).not.toContain('p1'); // 話者本人は自分の発言に反応しない
		expect(evaluatedIds).toEqual(expect.arrayContaining(['p2', 'p3']));
		// committedTurnId=t1 の history に永続される
		const savedForT1 = mockSet.mock.calls.some(
			(call) => (call[0] as { history?: Record<string, unknown> }).history?.t1 !== undefined
		);
		expect(savedForT1).toBe(true);
	});

	it('既に永続済みなら LLM 再評価せず awareness も再検出しない（同一ターン二重評価回避・1.7）', async () => {
		const personas = [makePersona('p1', '田中太郎'), makePersona('p2', '佐藤花子')];
		mockHistoryByPersona = { p2: { t1: { score: 3, mode: 'opinion' } } };
		txChapterTurns = [evaluatingTurn('t1')];

		await evaluateReactionsForCommittedTurn({
			topicId: 'topic1',
			chapterId: 'ch1',
			committedTurnId: 't1',
			personas,
			chapterTurns: [makeDebateTurn('t1')]
		});

		expect(mockEvaluateEngagement).not.toHaveBeenCalled();
		expect(mockAppendAwareness).not.toHaveBeenCalled();
	});

	it('気づきは engagement 評価に相乗りで検出し committedTurnId に紐づけ永続する（1.2/1.3）', async () => {
		const personas = [makePersona('p1', '田中太郎'), makePersona('p2', '佐藤花子')];
		const awareness = { kind: 'reception', content: 'なるほど', sourcePersonaId: 'p1' };
		mockEvaluateEngagement.mockImplementation(async (p: Persona) =>
			p.id === 'p2'
				? { personaId: 'p2', score: 3, mode: 'opinion', awareness }
				: { personaId: p.id, score: 2, mode: 'opinion', awareness: null }
		);
		txChapterTurns = [evaluatingTurn('t1')];

		await evaluateReactionsForCommittedTurn({
			topicId: 'topic1',
			chapterId: 'ch1',
			committedTurnId: 't1',
			personas,
			chapterTurns: [makeDebateTurn('t1')]
		});

		expect(mockAppendAwareness).toHaveBeenCalledTimes(1);
		expect(mockAppendAwareness.mock.calls[0][0].turnId).toBe('t1');
		expect(mockAppendAwareness.mock.calls[0][0].persona.id).toBe('p2');
	});

	it('反応永続とセットで当該ターンの status(evaluating) を解除する（2.5）', async () => {
		const personas = [makePersona('p1', '田中太郎'), makePersona('p2', '佐藤花子')];
		txChapterTurns = [evaluatingTurn('t1')];

		await evaluateReactionsForCommittedTurn({
			topicId: 'topic1',
			chapterId: 'ch1',
			committedTurnId: 't1',
			personas,
			chapterTurns: [makeDebateTurn('t1')]
		});

		expect(mockTxUpdate).toHaveBeenCalledTimes(1);
		const [, update] = mockTxUpdate.mock.calls[0];
		const turns = (update as { turns: DebateTurn[] }).turns;
		expect(turns.find((turn) => turn.id === 't1')?.status).toBeUndefined();
	});

	it('当該ターンの status が既に未設定なら status 解除の書き込みをしない（冪等・自己修復）', async () => {
		const personas = [makePersona('p1', '田中太郎'), makePersona('p2', '佐藤花子')];
		txChapterTurns = [makeDebateTurn('t1')]; // status なし

		await evaluateReactionsForCommittedTurn({
			topicId: 'topic1',
			chapterId: 'ch1',
			committedTurnId: 't1',
			personas,
			chapterTurns: [makeDebateTurn('t1')]
		});

		expect(mockTxUpdate).not.toHaveBeenCalled();
	});

	it('runId 不一致（敗者）では確定ターンの status を上書きしない（世代ガード・3.6）', async () => {
		const personas = [makePersona('p1', '田中太郎'), makePersona('p2', '佐藤花子')];
		txChapterTurns = [evaluatingTurn('t1')];
		txTopicRunId = 'run-B';

		await evaluateReactionsForCommittedTurn({
			topicId: 'topic1',
			chapterId: 'ch1',
			committedTurnId: 't1',
			personas,
			chapterTurns: [makeDebateTurn('t1')],
			runId: 'run-A'
		});

		expect(mockTxUpdate).not.toHaveBeenCalled();
	});
});
