import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Persona } from '../../../types/persona.types.js';
import type { Engagement, SpeakerSelection } from '../../../types/debate.types.js';
import type { AppendTurnInput } from '../../../types/turn.types.js';
import type { Chapter } from '../../../types/chapter.types.js';

// 非トランザクション get（isDebateActive 等）と書き込み
const mockGet = vi.fn().mockResolvedValue({
	exists: true,
	data: () => ({ phase: 'debate', phaseStatus: 'running' })
});
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockResolvedValue(undefined);

// トランザクション内 get / update（addTurn の冪等追記）
const mockTxGet = vi.fn();
const mockTxUpdate = vi.fn();
const mockRunTransaction = vi.fn(
	async (fn: (tx: { get: typeof mockTxGet; update: typeof mockTxUpdate }) => Promise<unknown>) =>
		fn({ get: mockTxGet, update: mockTxUpdate })
);

const mockDoc = vi.fn((path: string) => ({ path, get: mockGet, update: mockUpdate, set: mockSet }));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc, runTransaction: mockRunTransaction })),
	Timestamp: { now: vi.fn(() => 'mock-timestamp') },
	FieldValue: { arrayUnion: vi.fn((...args: unknown[]) => args[0]), delete: vi.fn(() => 'DELETE') }
}));

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'mock-turn-id') }));

const mockGenerateTurn = vi.fn();
vi.mock('../../../agents/persona-agent.js', () => ({
	generateTurn: (...args: unknown[]) => mockGenerateTurn(...args),
	generateImpression: vi.fn()
}));

const mockValidPersonaId = vi.fn((id: string | undefined) => id);
vi.mock('../../../pipeline/debate/utils.js', () => ({
	pipelineErrorMessage: vi.fn((e: unknown) => String(e)),
	validPersonaId: (id: string | undefined, _personas: unknown[]) => mockValidPersonaId(id)
}));

// 既定はパススルー（採用 reply = ドラフト、検証済み・補正なし）。分岐検証時に上書きする。
const mockVerifyAndReviseDraft = vi.fn(async ({ draft }: { draft: unknown }) => ({
	reply: draft,
	trace: { status: 'checked', revised: false, findings: [] }
}));
vi.mock('../../../pipeline/debate/inline-fact-check.js', () => ({
	verifyAndReviseDraft: (...args: unknown[]) => mockVerifyAndReviseDraft(...args)
}));

vi.mock('../../../utils/prompt-formatters.js', () => ({
	currentDateString: vi.fn(() => '2026年6月25日')
}));

// pendingTurn の反映/更新/削除は pending-turn.ts の責務。ここでは配線（呼び出し）のみ検証する
const mockSetPendingTurn = vi.fn().mockResolvedValue(undefined);
const mockUpdatePendingTurnStatus = vi.fn().mockResolvedValue(undefined);
const mockClearPendingTurn = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../pipeline/debate/pending-turn.js', () => ({
	setPendingTurn: (...args: unknown[]) => mockSetPendingTurn(...args),
	updatePendingTurnStatus: (...args: unknown[]) => mockUpdatePendingTurnStatus(...args),
	clearPendingTurn: (...args: unknown[]) => mockClearPendingTurn(...args)
}));

// 事実基盤の供給はサーバ権威経路。ここでは空コンテキストを返し、ターン生成配線のみ検証する。
vi.mock('../../../pipeline/topics/topic-context.js', () => ({
	getTopicContext: vi.fn(async () => ({}))
}));

import {
	generatePersonaTurn,
	addTurn,
	generateFacilitatorTurn
} from '../../../pipeline/debate/turn.js';
import { nanoid } from 'nanoid';

// --- トランザクション get の制御変数 ---
let txChapterTurns: Array<{ id: string }> = [];
let txTopicRunId: string | undefined = undefined;

const setupTxDocs = () => {
	mockTxGet.mockImplementation(async (ref: { path: string }) => {
		if (ref.path.includes('/chapters/')) {
			return { exists: true, data: () => ({ turns: txChapterTurns }) };
		}
		return { exists: true, data: () => ({ runId: txTopicRunId }) };
	});
};

/** mockTxUpdate に書かれた最新ターンレコードを取り出す */
const getWrittenTurn = (): Record<string, unknown> => {
	const call = mockTxUpdate.mock.calls.find(
		(c) => (c[1] as { turns?: unknown[] }).turns !== undefined
	);
	const turns = (call![1] as { turns: Record<string, unknown>[] }).turns;
	return turns[turns.length - 1];
};

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

const mockChapter: Chapter = { id: 'ch1', title: 'テスト章' };

const makeDebateState = () => ({
	turns: [] as Array<Record<string, unknown>>,
	lastSpeakerId: undefined as string | undefined,
	silenceMap: new Map(),
	speakCount: new Map(),
	queuedIntents: new Map(),
	agenda: []
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
		txChapterTurns = [];
		txTopicRunId = undefined;
		setupTxDocs();
		mockGet.mockResolvedValue({
			exists: true,
			data: () => ({ phase: 'debate', phaseStatus: 'running' })
		});
		mockDoc.mockImplementation((path: string) => ({
			path,
			get: mockGet,
			update: mockUpdate,
			set: mockSet
		}));
		mockValidPersonaId.mockImplementation((id: string | undefined) => id);
		mockVerifyAndReviseDraft.mockImplementation(async ({ draft }: { draft: unknown }) => ({
			reply: draft,
			trace: { status: 'checked', revised: false, findings: [] }
		}));
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

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement()
		});

		expect(getWrittenTurn().speechMode).toBe('question');
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

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement()
		});

		expect(getWrittenTurn().speechMode).toBe('opinion');
	});

	it('自己 target（発話者自身を指名）は無効化し targetPersonaId/targetedBy を保存しない', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: {
				content: '自分を指名',
				speechMode: 'question',
				beliefChange: null,
				targetPersonaId: 'p1' // speakerSelection.personaId と同一（自己指名）
			}
		});

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement()
		});

		const written = getWrittenTurn();
		expect(written.targetPersonaId).toBeUndefined();
		expect(written.targetedBy).toBeUndefined();
		// 自己指名は validPersonaId を経由する前に弾かれる
		expect(mockValidPersonaId).not.toHaveBeenCalled();
	});

	it('不正な target（存在しない ID）は validPersonaId が無効化し保存しない', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: {
				content: '不明を指名',
				speechMode: 'question',
				beliefChange: null,
				targetPersonaId: 'unknown'
			}
		});
		mockValidPersonaId.mockReturnValue(undefined);

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement()
		});

		const written = getWrittenTurn();
		expect(written.targetPersonaId).toBeUndefined();
		expect(written.targetedBy).toBeUndefined();
	});

	it('opinion モードは speechMode: opinion のままターンを保存する', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '意見発言', speechMode: 'opinion', beliefChange: null }
		});

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion', intentSummary: '意見' })
		});

		expect(getWrittenTurn().speechMode).toBe('opinion');
	});

	it('Firestoreに書き込むターンに speakerName/speakerRole が含まれない', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '意見発言', speechMode: 'opinion', beliefChange: null }
		});

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		const savedTurn = getWrittenTurn();
		expect(savedTurn.speakerName).toBeUndefined();
		expect(savedTurn.speakerRole).toBeUndefined();
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
		// 章ローカル長を state.turns に合わせる（期待位置 = 1）
		txChapterTurns = [{ id: 't0' }];

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
		txChapterTurns = [{ id: 'f0' }];

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

	it('runId ミスマッチ時に addTurn の generation_mismatch を generatePersonaTurn が伝播する', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '発言', speechMode: 'opinion', beliefChange: null }
		});
		txTopicRunId = 'run-B';
		const state = { ...makeDebateState(), runId: 'run-A' };
		const result = await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state,
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement()
		});
		expect(result).toEqual({ status: 'rejected', reason: 'generation_mismatch' });
		expect(mockTxUpdate).not.toHaveBeenCalled();
	});

	it('期待位置不一致（章 doc が先行）の場合 index_mismatch を伝播し追記しない', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '発言', speechMode: 'opinion', beliefChange: null }
		});
		// state.turns は空（期待位置 0）だが章 doc は既に1件 → index_mismatch
		txChapterTurns = [{ id: 'already' }];
		const result = await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement()
		});
		expect(result).toEqual({ status: 'rejected', reason: 'index_mismatch' });
		expect(mockTxUpdate).not.toHaveBeenCalled();
	});

	it('Firestoreへの書き込みは chapters/{chapterId} に行われる', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '意見発言', speechMode: 'opinion', beliefChange: null }
		});

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
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

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		expect(getWrittenTurn().chapterId).toBeUndefined();
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

	it('ドラフト生成後に verifyAndReviseDraft へドラフトと検証文脈（テーマ・章・フォーカス）を渡す', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: 'ドラフト本文', speechMode: 'opinion', beliefChange: null }
		});

		await generatePersonaTurn({
			topicId: 'topic1',
			topicTitle: 'テーマ名',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		expect(mockVerifyAndReviseDraft).toHaveBeenCalledOnce();
		const arg = mockVerifyAndReviseDraft.mock.calls[0][0];
		expect(arg.draft.content).toBe('ドラフト本文');
		expect(arg.factCheckContext.topicTitle).toBe('テーマ名');
		expect(arg.factCheckContext.chapterTitle).toBe('テスト章');
		// アクティブ論点不在のため discussionScope は章タイトルにフォールバックする
		expect(arg.factCheckContext.discussionScope).toBe('テスト章');
	});

	it('補正後に採用された発言（再生成）の内容・発言モード・指名先で正式登録する', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '誤りドラフト', speechMode: 'opinion', beliefChange: null }
		});
		mockVerifyAndReviseDraft.mockResolvedValueOnce({
			reply: {
				content: '補正後本文',
				speechMode: 'question',
				beliefChange: null,
				targetPersonaId: 'p2'
			},
			trace: { status: 'checked', revised: true, findings: [], originalContent: '誤りドラフト' }
		});
		mockValidPersonaId.mockReturnValue('p2');

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement()
		});

		const written = getWrittenTurn();
		expect(written.content).toBe('補正後本文');
		expect(written.speechMode).toBe('question');
		expect(written.targetPersonaId).toBe('p2');
	});

	it('補正トレースを永続レコードと state.turns に保存する（4.2）', async () => {
		const trace = {
			status: 'checked',
			revised: true,
			findings: [
				{
					id: 'f1',
					turnId: '',
					speakerType: 'persona',
					claim: '誤った主張',
					verdict: 'incorrect',
					correction: '正しい事実',
					reason: '理由',
					sources: []
				}
			],
			originalContent: '原ドラフト'
		};
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '原ドラフト', speechMode: 'opinion', beliefChange: null }
		});
		mockVerifyAndReviseDraft.mockResolvedValueOnce({
			reply: { content: '補正後', speechMode: 'opinion', beliefChange: null },
			trace
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

		expect(getWrittenTurn().factCheck).toEqual(trace);
		expect((state.turns[0] as Record<string, unknown>).factCheck).toEqual(trace);
	});

	it('未検証（unverified）で登録された場合もその事実をトレースに残す（4.2）', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: 'ドラフト', speechMode: 'opinion', beliefChange: null }
		});
		mockVerifyAndReviseDraft.mockResolvedValueOnce({
			reply: { content: 'ドラフト', speechMode: 'opinion', beliefChange: null },
			trace: { status: 'unverified', revised: false, findings: [] }
		});

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		expect(getWrittenTurn().factCheck).toEqual({
			status: 'unverified',
			revised: false,
			findings: []
		});
	});

	it('persona ターン確定時に status=evaluating 付きで追記する（末尾評価対象マーク・2.3/2.4）', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '発言', speechMode: 'opinion', beliefChange: null }
		});

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		expect(getWrittenTurn().status).toBe('evaluating');
	});

	it('persona ターン確定で同一更新の pendingTurn を削除する（生成中→確定の原子的移送・2.8）', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '発言', speechMode: 'opinion', beliefChange: null }
		});

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		const call = mockTxUpdate.mock.calls.find(
			(c) => (c[1] as { turns?: unknown[] }).turns !== undefined
		);
		expect((call![1] as { pendingTurn: unknown }).pendingTurn).toBe('DELETE');
	});

	it('ドラフト生成後に討論が停止していたら検証・補正せず skipped を返す（1.5 経路前の短絡）', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: 'ドラフト', speechMode: 'opinion', beliefChange: null }
		});
		mockGet.mockResolvedValue({
			exists: true,
			data: () => ({ phase: 'debate', phaseStatus: 'stopped' })
		});

		const result = await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		expect(result).toEqual({ status: 'skipped' });
		expect(mockVerifyAndReviseDraft).not.toHaveBeenCalled();
		expect(mockTxUpdate).not.toHaveBeenCalled();
	});

	it('生成開始で pendingTurn を generating として先行作成する（話者・frontier・発番id・2.1）', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '発言', speechMode: 'opinion', beliefChange: null }
		});

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		expect(mockSetPendingTurn).toHaveBeenCalledTimes(1);
		const pending = mockSetPendingTurn.mock.calls[0][0].pendingTurn;
		expect(pending.personaId).toBe('p1');
		expect(pending.status).toBe('generating');
		expect(pending.expectedTurnIndex).toBe(0);
		expect(pending.id).toBe('mock-turn-id');
	});

	it('ファクトチェック開始で pendingTurn を fact-checking に更新する（2.2）', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '発言', speechMode: 'opinion', beliefChange: null }
		});

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		expect(mockUpdatePendingTurnStatus).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'mock-turn-id', status: 'fact-checking' })
		);
	});

	it('コミットへ pendingTurn の発番 id を渡し、同 id を turns へ移送する（addTurn は再発番しない・2.1）', async () => {
		vi.mocked(nanoid).mockReturnValueOnce('pending-issued-id');
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '発言', speechMode: 'opinion', beliefChange: null }
		});

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		expect(mockSetPendingTurn.mock.calls[0][0].pendingTurn.id).toBe('pending-issued-id');
		expect(getWrittenTurn().id).toBe('pending-issued-id');
	});

	it('討論停止（skipped）で自 id の pendingTurn を削除する（3.4）', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: 'ドラフト', speechMode: 'opinion', beliefChange: null }
		});
		mockGet.mockResolvedValue({
			exists: true,
			data: () => ({ phase: 'debate', phaseStatus: 'stopped' })
		});

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		expect(mockClearPendingTurn).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'mock-turn-id' })
		);
	});

	it('追記棄却（frontier 敗者・index_mismatch）で自 id の pendingTurn を削除する（3.6）', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '発言', speechMode: 'opinion', beliefChange: null }
		});
		txChapterTurns = [{ id: 'already' }]; // 期待位置0だが章 doc は1件 → index_mismatch

		const result = await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		expect(result).toEqual({ status: 'rejected', reason: 'index_mismatch' });
		expect(mockClearPendingTurn).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'mock-turn-id' })
		);
	});

	it('pendingTurn ライフサイクル: generating→fact-checking→コミット(evaluating)+削除の順で遷移する（6.2）', async () => {
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '発言', speechMode: 'opinion', beliefChange: null }
		});

		await generatePersonaTurn({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			state: makeDebateState(),
			speakerSelection: makeSpeakerSelection(),
			engagement: makeEngagement({ mode: 'opinion' })
		});

		// 段階: generating で先行作成 → fact-checking へ更新
		expect(mockSetPendingTurn.mock.calls[0][0].pendingTurn.status).toBe('generating');
		expect(mockUpdatePendingTurnStatus.mock.calls[0][0].status).toBe('fact-checking');

		// 順序: set(generating) < update(fact-checking) < addTurn commit
		const setOrder = mockSetPendingTurn.mock.invocationCallOrder[0];
		const updateOrder = mockUpdatePendingTurnStatus.mock.invocationCallOrder[0];
		const commitOrder = mockTxUpdate.mock.invocationCallOrder[0];
		expect(setOrder).toBeLessThan(updateOrder);
		expect(updateOrder).toBeLessThan(commitOrder);

		// コミットで evaluating 付与＋pendingTurn 削除（同一更新）
		const commitUpdate = mockTxUpdate.mock.calls.find(
			(c) => (c[1] as { turns?: unknown[] }).turns !== undefined
		)![1];
		const committedTurns = (commitUpdate as { turns: Record<string, unknown>[] }).turns;
		expect(committedTurns[committedTurns.length - 1].status).toBe('evaluating');
		expect((commitUpdate as { pendingTurn: unknown }).pendingTurn).toBe('DELETE');
	});

	it('生成失敗で自 id の pendingTurn を削除してから throw する（3.5）', async () => {
		mockGenerateTurn.mockResolvedValue({ ok: false, error: 'AI_API_ERROR' });

		await expect(
			generatePersonaTurn({
				topicId: 'topic1',
				personas,
				chapter: mockChapter,
				state: makeDebateState(),
				speakerSelection: makeSpeakerSelection(),
				engagement: makeEngagement({ mode: 'opinion' })
			})
		).rejects.toThrow();

		expect(mockClearPendingTurn).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'mock-turn-id' })
		);
	});
});

describe('addTurn - 冪等トランザクション追記', () => {
	const baseInput = (overrides: Partial<AppendTurnInput> = {}): AppendTurnInput => ({
		topicId: 't1',
		chapterId: 'ch1',
		expectedTurnIndex: 0,
		turn: { speakerType: 'persona', personaId: 'p1', content: '発言' },
		...overrides
	});

	beforeEach(() => {
		vi.clearAllMocks();
		txChapterTurns = [];
		txTopicRunId = undefined;
		setupTxDocs();
		mockDoc.mockImplementation((path: string) => ({
			path,
			get: mockGet,
			update: mockUpdate,
			set: mockSet
		}));
	});

	it('期待位置が章ローカル turns.length と一致すれば committed を返し1ターン追記する', async () => {
		txChapterTurns = [{ id: 'a' }, { id: 'b' }];
		const result = await addTurn(baseInput({ expectedTurnIndex: 2 }));

		expect(result).toEqual({ status: 'committed', id: 'mock-turn-id' });
		expect(mockTxUpdate).toHaveBeenCalledTimes(1);
		const [, update] = mockTxUpdate.mock.calls[0];
		expect((update as { turns: unknown[] }).turns).toHaveLength(3);
	});

	it('入力で id を指定するとその id を採用し発番しない（pendingTurn 発番 id の移送）', async () => {
		const result = await addTurn(baseInput({ expectedTurnIndex: 0, id: 'pending-issued-id' }));

		expect(result).toEqual({ status: 'committed', id: 'pending-issued-id' });
		expect(getWrittenTurn().id).toBe('pending-issued-id');
	});

	it('id 未指定なら従来どおりトランザクション内で nanoid を発番する（facilitator 経路の互換）', async () => {
		const result = await addTurn(baseInput({ expectedTurnIndex: 0 }));
		expect(result).toEqual({ status: 'committed', id: 'mock-turn-id' });
	});

	it('コミット時に turn の status=evaluating を永続し、同一更新で pendingTurn を削除する（2.3/2.4/3.6）', async () => {
		await addTurn(
			baseInput({
				expectedTurnIndex: 0,
				turn: { speakerType: 'persona', personaId: 'p1', content: '発言', status: 'evaluating' }
			})
		);
		const [, update] = mockTxUpdate.mock.calls[0];
		const turns = (update as { turns: Record<string, unknown>[] }).turns;
		expect(turns).toHaveLength(1);
		expect(turns[0].status).toBe('evaluating');
		expect((update as { pendingTurn: unknown }).pendingTurn).toBe('DELETE');
	});

	it('index_mismatch では turns も pendingTurn も一切書き換えない（副作用なし棄却・3.6）', async () => {
		txChapterTurns = [{ id: 'a' }];
		const result = await addTurn(baseInput({ expectedTurnIndex: 0 }));

		expect(result).toEqual({ status: 'rejected', reason: 'index_mismatch' });
		expect(mockTxUpdate).not.toHaveBeenCalled();
	});

	it('期待位置が一致しなければ index_mismatch を返し追記しない', async () => {
		txChapterTurns = [{ id: 'a' }, { id: 'b' }];
		const result = await addTurn(baseInput({ expectedTurnIndex: 1 }));

		expect(result).toEqual({ status: 'rejected', reason: 'index_mismatch' });
		expect(mockTxUpdate).not.toHaveBeenCalled();
	});

	it('runId が topic doc と不一致なら generation_mismatch を返し追記しない', async () => {
		txTopicRunId = 'run-A';
		const result = await addTurn(baseInput({ expectedTurnIndex: 0, runId: 'run-B' }));

		expect(result).toEqual({ status: 'rejected', reason: 'generation_mismatch' });
		expect(mockTxUpdate).not.toHaveBeenCalled();
	});

	it('runId が一致すれば committed を返す', async () => {
		txTopicRunId = 'run-A';
		const result = await addTurn(baseInput({ expectedTurnIndex: 0, runId: 'run-A' }));
		expect(result).toEqual({ status: 'committed', id: 'mock-turn-id' });
	});

	it('runId 欠如時は世代照合をスキップし committed を返す（topic doc を読まない）', async () => {
		txTopicRunId = 'run-A';
		const result = await addTurn(baseInput({ expectedTurnIndex: 0 }));

		expect(result).toEqual({ status: 'committed', id: 'mock-turn-id' });
		const readPaths = mockTxGet.mock.calls.map((c) => (c[0] as { path: string }).path);
		expect(readPaths).not.toContain('topics/t1');
	});

	it('topic doc に runId が無ければ照合をスキップし committed を返す（後方互換）', async () => {
		txTopicRunId = undefined;
		const result = await addTurn(baseInput({ expectedTurnIndex: 0, runId: 'run-A' }));
		expect(result).toEqual({ status: 'committed', id: 'mock-turn-id' });
	});

	it('progressPatch を指定すると同一更新で quietStreak / agendaItemStatuses を書く', async () => {
		await addTurn(
			baseInput({
				expectedTurnIndex: 0,
				progressPatch: {
					quietStreak: 3,
					agendaItemStatuses: [{ point: '論点A', status: 'addressed' }]
				}
			})
		);
		const [, update] = mockTxUpdate.mock.calls[0];
		expect((update as { quietStreak: number }).quietStreak).toBe(3);
		expect((update as { agendaItemStatuses: unknown[] }).agendaItemStatuses).toEqual([
			{ point: '論点A', status: 'addressed' }
		]);
	});

	it('順次実行では正当なターンが脱落しない（毎回 index が前進し committed）', async () => {
		mockTxUpdate.mockImplementation((_ref: unknown, update: { turns: Array<{ id: string }> }) => {
			txChapterTurns = [...update.turns];
		});

		for (let i = 0; i < 5; i++) {
			const result = await addTurn(baseInput({ expectedTurnIndex: i }));
			expect(result.status).toBe('committed');
		}
		expect(txChapterTurns).toHaveLength(5);
	});
});

describe('generateFacilitatorTurn - 期待位置照合・runId 世代照合', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		txChapterTurns = [];
		txTopicRunId = undefined;
		setupTxDocs();
		mockDoc.mockImplementation((path: string) => ({
			path,
			get: mockGet,
			update: mockUpdate,
			set: mockSet
		}));
	});

	it('runId ミスマッチ時に rejected を返し state.turns に追加しない', async () => {
		txTopicRunId = 'run-B';
		const state = { ...makeDebateState(), runId: 'run-A' };
		const result = await generateFacilitatorTurn({
			topicId: 'topic1',
			state,
			content: 'テスト発言',
			chapterId: 'ch1'
		});
		expect(result).toEqual({ status: 'rejected', reason: 'generation_mismatch' });
		expect(state.turns).toHaveLength(0);
		expect(mockTxUpdate).not.toHaveBeenCalled();
	});

	it('runId 一致時は committed を返し state.turns に追加する', async () => {
		txTopicRunId = 'run-A';
		const state = { ...makeDebateState(), runId: 'run-A' };
		const result = await generateFacilitatorTurn({
			topicId: 'topic1',
			state,
			content: 'テスト発言',
			chapterId: 'ch1'
		});
		expect(result).toEqual({ status: 'committed', id: 'mock-turn-id' });
		expect(state.turns).toHaveLength(1);
		expect(mockTxUpdate).toHaveBeenCalledOnce();
	});

	it('facilitator ターンには status を付与しない（status/pendingTurn は persona ターンのみ）', async () => {
		txTopicRunId = 'run-A';
		const state = { ...makeDebateState(), runId: 'run-A' };
		await generateFacilitatorTurn({
			topicId: 'topic1',
			state,
			content: 'テスト発言',
			chapterId: 'ch1'
		});
		expect(getWrittenTurn().status).toBeUndefined();
	});
});
