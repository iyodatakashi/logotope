import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Persona } from '../../../types/persona.types.js';
import type { Engagement, SpeakerSelection } from '../../../types/debate.types.js';
import type { Chapter } from '../../../types/chapter.types.js';

/**
 * インライン補正フローの統合テスト（要件6）。
 * verifyAndReviseDraft / checkContent は実物を使い、LLM・grounding・Firestore など
 * リーフ依存のみをモックして、ドラフト生成→検証→再生成→正式登録の結線を検証する。
 */

// --- Firestore（addTurn の冪等トランザクション + isDebateActive の get）---
const mockGet = vi.fn().mockResolvedValue({
	exists: true,
	data: () => ({ phase: 'debate', phaseStatus: 'running' })
});
const mockTxGet = vi.fn();
const mockTxUpdate = vi.fn();
const mockRunTransaction = vi.fn(
	async (fn: (tx: { get: typeof mockTxGet; update: typeof mockTxUpdate }) => Promise<unknown>) =>
		fn({ get: mockTxGet, update: mockTxUpdate })
);
const mockDoc = vi.fn((path: string) => ({ path, get: mockGet }));
vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc, runTransaction: mockRunTransaction })),
	Timestamp: { now: vi.fn(() => 'mock-timestamp') }
}));

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'mock-id') }));

// --- ペルソナ発言生成（ドラフト + 再生成の両方に使われる）---
const mockGenerateTurn = vi.fn();
vi.mock('../../../agents/persona-agent.js', () => ({
	generateTurn: (...args: unknown[]) => mockGenerateTurn(...args),
	generatePostDebateComment: vi.fn()
}));

const mockValidPersonaId = vi.fn((id: string | undefined) => id);
vi.mock('../../../pipeline/debate/utils.js', () => ({
	pipelineErrorMessage: vi.fn((e: unknown) => String(e)),
	validPersonaId: (id: string | undefined, _personas: unknown[]) => mockValidPersonaId(id)
}));

vi.mock('../../../pipeline/topics/topic-context.js', () => ({
	getTopicContext: vi.fn(async () => ({}))
}));

vi.mock('../../../utils/prompt-formatters.js', () => ({
	currentDateString: vi.fn(() => '2026年6月25日')
}));

// --- 検証コア（checkContent）のリーフ: ai / google provider / grounding / judge ---
const { mockGenerateText, mockGenerateObject } = vi.hoisted(() => ({
	mockGenerateText: vi.fn(),
	mockGenerateObject: vi.fn()
}));
vi.mock('ai', () => ({
	generateText: mockGenerateText,
	generateObject: mockGenerateObject
}));

const { mockGetGoogleProvider, mockGoogleProvider } = vi.hoisted(() => {
	const googleSearch = vi.fn(() => ({ name: 'google_search', type: 'provider-defined' }));
	const provider = Object.assign(
		vi.fn(() => 'mock-google-model'),
		{ tools: { googleSearch } }
	);
	return { mockGetGoogleProvider: vi.fn(() => provider), mockGoogleProvider: provider };
});
vi.mock('../../../llm/models.js', () => ({
	getPipelineModel: vi.fn(() => 'mock-pipeline-model'),
	getGoogleProvider: mockGetGoogleProvider
}));

const { mockExtractSources, mockResolveSourceUrls } = vi.hoisted(() => ({
	mockExtractSources: vi.fn(() => [{ query: 'q', summary: 's', results: [] }]),
	mockResolveSourceUrls: vi.fn(async () => [
		{ query: 'q', summary: 's', results: [{ title: 'https://a.com', url: 'https://a.com' }] }
	])
}));
vi.mock('../../../search/grounding.js', () => ({
	extractSources: mockExtractSources,
	resolveSourceUrls: mockResolveSourceUrls
}));

const { mockJudge } = vi.hoisted(() => ({
	mockJudge: vi.fn(async (_content: string, findings: unknown[]) => ({
		kept: findings,
		judgments: []
	}))
}));
vi.mock('../../../pipeline/fact-check/fact-check-judge.js', () => ({
	judgeCorrectionWorthiness: mockJudge
}));

const { mockGetChapterById } = vi.hoisted(() => ({ mockGetChapterById: vi.fn() }));
vi.mock('../../../pipeline/debate/chapter.js', () => ({ getChapterById: mockGetChapterById }));

const { mockGetTopicById } = vi.hoisted(() => ({ mockGetTopicById: vi.fn() }));
vi.mock('../../../pipeline/topics/topics.js', () => ({ getTopicById: mockGetTopicById }));

import { generatePersonaTurn } from '../../../pipeline/debate/turn.js';

// --- ai のディスパッチ（Phase0 ゲート schema vs Phase2 構造化 schema）---
let phase2Queue: unknown[];
const groundingResult = () => ({
	text: 'verification text',
	providerMetadata: {
		google: {
			groundingMetadata: {
				groundingChunks: [{ web: { uri: 'https://a.com', title: 'a' } }],
				webSearchQueries: ['q']
			}
		}
	}
});
const phase2Result = (findings: unknown[]) => ({ object: { findings } });

// --- addTurn の tx 制御 ---
let txChapterTurns: Array<{ id: string }> = [];
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
	llmType: 'claude',
	approved: true,
	sortOrder: 0
});

const personas = [makePersona('p1', '田中太郎'), makePersona('p2', '佐藤花子')];
const chapter: Chapter = { id: 'ch1', title: '戦時下の医療' };
const speakerSelection: SpeakerSelection = { personaId: 'p1', reason: 'score' };
const engagement: Engagement = { personaId: 'p1', score: 4, mode: 'opinion' };
const makeState = () => ({
	turns: [] as Array<Record<string, unknown>>,
	lastSpeakerId: undefined as string | undefined,
	silenceMap: new Map(),
	speakCount: new Map(),
	queuedIntents: new Map(),
	discussionPoints: []
});

const draftReply = (overrides: Record<string, unknown> = {}) => ({
	ok: true,
	value: {
		content: '日本の人口は2億人である。',
		speechMode: 'opinion',
		beliefChange: null,
		...overrides
	}
});

const oneIncorrectFinding = () =>
	phase2Result([
		{
			claim: '日本の人口は2億人である',
			verdict: 'incorrect',
			correction: '約1.2億人',
			reason: '統計と矛盾',
			sourceIndices: [1]
		}
	]);

beforeEach(() => {
	vi.clearAllMocks();
	txChapterTurns = [];
	mockTxGet.mockImplementation(async (ref: { path: string }) => {
		if (ref.path.includes('/chapters/')) {
			return { exists: true, data: () => ({ turns: txChapterTurns }) };
		}
		return { exists: true, data: () => ({}) };
	});
	mockGet.mockResolvedValue({
		exists: true,
		data: () => ({ phase: 'debate', phaseStatus: 'running' })
	});
	mockDoc.mockImplementation((path: string) => ({ path, get: mockGet }));
	mockValidPersonaId.mockImplementation((id: string | undefined) => id);
	mockGetGoogleProvider.mockReturnValue(mockGoogleProvider);
	mockResolveSourceUrls.mockResolvedValue([
		{ query: 'q', summary: 's', results: [{ title: 'https://a.com', url: 'https://a.com' }] }
	]);
	mockJudge.mockImplementation(async (_c: string, findings: unknown[]) => ({
		kept: findings,
		judgments: []
	}));
	mockGetTopicById.mockResolvedValue({ id: 't1', title: 'ウクライナ情勢と医療' });
	phase2Queue = [];
	mockGenerateObject.mockImplementation(
		async (args: { schema: { shape: object }; messages: Array<{ content: string }> }) => {
			const isGate = Object.keys(args.schema.shape).includes('assertedClaims');
			if (isGate) {
				// 既定: 【対象の発言】以降を全文1主張として抽出（部分文字列照合を通す）
				const text = args.messages[0].content;
				const marker = '【対象の発言】\n';
				const idx = text.lastIndexOf(marker);
				const content = idx >= 0 ? text.slice(idx + marker.length) : '';
				return { object: { assertedClaims: content ? [{ claim: content }] : [] } };
			}
			return phase2Queue.length ? phase2Queue.shift() : phase2Result([]);
		}
	);
});

describe('インライン補正の結線（ドラフト→検証→再生成→正式登録）', () => {
	it('指摘ありドラフトは再生成され、補正後発言が登録される（指名先再検証・モード確定・トレース revised:true）', async () => {
		// 1回目: ドラフト（誤り）、2回目: 再生成（補正後・指名先変更）
		mockGenerateTurn.mockResolvedValueOnce(draftReply()).mockResolvedValueOnce({
			ok: true,
			value: {
				content: '正しくは約1.2億人です。',
				speechMode: 'question',
				beliefChange: null,
				targetPersonaId: 'p2'
			}
		});
		mockGenerateText.mockResolvedValue(groundingResult());
		phase2Queue.push(oneIncorrectFinding());
		mockValidPersonaId.mockReturnValue('p2');

		const state = makeState();
		const result = await generatePersonaTurn({
			topicId: 'topic1',
			topicTitle: 'ウクライナ情勢と医療',
			personas,
			chapter,
			state,
			speakerSelection,
			engagement
		});

		// ドラフト + 再生成で 2 回呼ばれ、2回目に factCheckFeedback が渡る
		expect(mockGenerateTurn).toHaveBeenCalledTimes(2);
		expect(mockGenerateTurn.mock.calls[1][1].factCheckFeedback).toEqual([
			{
				claim: '日本の人口は2億人である',
				verdict: 'incorrect',
				correction: '約1.2億人',
				reason: '統計と矛盾'
			}
		]);

		// 補正後発言が登録され、指名先再検証・発言モード確定が行われる
		const written = getWrittenTurn();
		expect(written.content).toBe('正しくは約1.2億人です。');
		expect(written.speechMode).toBe('question');
		expect(written.targetPersonaId).toBe('p2');
		const trace = written.factCheck as Record<string, unknown>;
		expect(trace.status).toBe('checked');
		expect(trace.revised).toBe(true);
		expect(trace.originalContent).toBe('日本の人口は2億人である。');
		expect(result.status).toBe('committed');
		if (result.status === 'committed') expect(result.turnId).toBe('mock-id');
	});

	it('検証失敗（provider 不在）でも討論は停止せず、未補正で登録され unverified トレースが残る', async () => {
		mockGenerateTurn.mockResolvedValueOnce(draftReply());
		mockGetGoogleProvider.mockReturnValue(null); // checkContent が AI_API_ERROR

		const result = await generatePersonaTurn({
			topicId: 'topic1',
			topicTitle: 'ウクライナ情勢と医療',
			personas,
			chapter,
			state: makeState(),
			speakerSelection,
			engagement
		});

		expect(result).not.toBeNull();
		expect(mockGenerateTurn).toHaveBeenCalledTimes(1); // 再生成なし
		const written = getWrittenTurn();
		expect(written.content).toBe('日本の人口は2億人である。');
		expect((written.factCheck as Record<string, unknown>).status).toBe('unverified');
	});

	it('再生成失敗時はドラフトを登録し、検出済み指摘を記録する（revised:false / findings あり）', async () => {
		mockGenerateTurn.mockResolvedValueOnce(draftReply()).mockResolvedValueOnce({
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'x', retryable: true }
		});
		mockGenerateText.mockResolvedValue(groundingResult());
		phase2Queue.push(oneIncorrectFinding());

		await generatePersonaTurn({
			topicId: 'topic1',
			topicTitle: 'ウクライナ情勢と医療',
			personas,
			chapter,
			state: makeState(),
			speakerSelection,
			engagement
		});

		const written = getWrittenTurn();
		expect(written.content).toBe('日本の人口は2億人である。'); // 原ドラフト採用
		const trace = written.factCheck as Record<string, unknown>;
		expect(trace.status).toBe('checked');
		expect(trace.revised).toBe(false);
		expect((trace.findings as unknown[]).length).toBe(1);
	});
});
