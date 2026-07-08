/**
 * 結合検証（Task 3.1）: プロンプトキャッシュ配置（1.1）と同一 turnId 再利用（2.2）が、
 * claude/gemini/gpt 混在で発言意欲評価の内容・スキーマを変えないこと、および同一ターン状態の
 * 再処理で LLM 呼び出しが増えないことを検証する。engagement.ts と persona-agent.ts は実物を使い、
 * I/O（ai SDK / Firestore / prompt-formatters / search / awareness）のみモックする。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Persona } from '../../../types/persona.types.js';
import type { DebateState } from '../../../types/debate.types.js';
import type { DebateTurn } from '../../../types/turn.types.js';

vi.mock('ai', () => ({
	generateText: vi.fn(),
	generateObject: vi.fn(),
	jsonSchema: (schema: unknown) => schema,
	stepCountIs: vi.fn((n: number) => n),
	Output: { object: vi.fn(() => ({})) }
}));

vi.mock('../../../llm/models.js', () => ({
	getPersonaModel: vi.fn((llmType: string) => `model-${llmType}`)
}));

vi.mock('../../../search/search-service.js', () => ({
	isSearchAvailable: vi.fn(() => false),
	executeSearch: vi.fn()
}));

vi.mock('../../../utils/prompt-formatters.js', () => ({
	formatTurns: vi.fn(() => '【会話】'),
	currentDateString: vi.fn(() => '2026-07-05'),
	formatFactBaseSection: vi.fn(() => ''),
	formatAwarenessSection: vi.fn(() => '')
}));

const mockAppendAwareness = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../pipeline/debate/awareness.js', () => ({
	getBelief: vi.fn(() => '信念テキスト'),
	appendAwareness: (...args: unknown[]) => mockAppendAwareness(...args)
}));

const mockSet = vi.fn().mockResolvedValue(undefined);
// personaId -> 永続済み history マップ（同一 turnId 再利用の再現用）。既定は空＝未永続。
let mockHistoryByPersona: Record<string, Record<string, unknown>> = {};
const mockDoc = vi.fn((path: string) => {
	const personaId = path.split('/').pop() ?? '';
	return {
		set: mockSet,
		get: vi.fn().mockResolvedValue({
			get: (field: string) => (field === 'history' ? mockHistoryByPersona[personaId] : undefined)
		})
	};
});
vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc }))
}));

import { evaluateEngagements } from '../../../pipeline/debate/engagement.js';
import { generateObject } from 'ai';

const makePersona = (id: string, name: string, llmType: Persona['llmType']): Persona => ({
	id,
	topicId: 'topic1',
	name,
	age: 40,
	occupation: '会社員',
	stakeholderRole: '市民',
	specificRole: '市民',
	background: '背景',
	interests: '関心',
	nationality: '日本',
	engagementLevel: 'moderate',
	llmType,
	approved: true,
	sortOrder: 0,
	interviewRecord: '取材記録'
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

const makeTurn = (id: string): DebateTurn => ({
	id,
	speakerType: 'persona',
	personaId: 'p0',
	content: '発言',
	speechMode: 'opinion',
	createdAt: ''
});

// 混在プロバイダ: claude / gemini / gpt
const personas = [
	makePersona('p1', '田中太郎', 'claude'),
	makePersona('p2', '佐藤花子', 'gemini'),
	makePersona('p3', '鈴木次郎', 'gpt')
];

const systemTextOf = (system: unknown): string =>
	typeof system === 'string' ? system : (system as { content: string }).content;

describe('結合: 混在プロバイダの非退行と冗長削減（Task 3.1）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockHistoryByPersona = {};
		vi.mocked(generateObject).mockImplementation(
			async () =>
				({
					object: { score: 3, mode: 'opinion', intentSummary: null, awareness: null }
				}) as never
		);
	});

	it('claude はキャッシュ対象 system、gemini/gpt は文字列 system で評価し、出力スキーマは不変', async () => {
		const captured: Array<{ system: unknown }> = [];
		vi.mocked(generateObject).mockImplementation(async (args: unknown) => {
			captured.push({ system: (args as { system: unknown }).system });
			return {
				object: { score: 3, mode: 'opinion', intentSummary: null, awareness: null }
			} as never;
		});

		const result = await evaluateEngagements({
			topicId: 'topic1',
			chapterId: 'ch1',
			personas,
			state: makeState({ turns: [makeTurn('t1')] }),
			chapterTurns: [makeTurn('t1')]
		});

		// 3人とも評価され、score/mode スキーマは不変
		expect(result).toHaveLength(3);
		for (const r of result) {
			expect(typeof r.score).toBe('number');
			expect(['opinion', 'fact', 'none', 'question']).toContain(r.mode);
		}

		// claude(田中) はキャッシュ対象 system メッセージ（cacheControl 付き）
		const claudeCall = captured.find((c) => systemTextOf(c.system).includes('田中太郎'))!;
		expect(typeof claudeCall.system).toBe('object');
		expect(
			(claudeCall.system as { providerOptions: { anthropic: { cacheControl: { type: string } } } })
				.providerOptions.anthropic.cacheControl.type
		).toBe('ephemeral');

		// gemini(佐藤) / gpt(鈴木) は従来の文字列 system（キャッシュ非適用）
		const geminiCall = captured.find((c) => systemTextOf(c.system).includes('佐藤花子'))!;
		const gptCall = captured.find((c) => systemTextOf(c.system).includes('鈴木次郎'))!;
		expect(typeof geminiCall.system).toBe('string');
		expect(typeof gptCall.system).toBe('string');
	});

	it('同一 turnId の再処理では意欲評価の LLM 呼び出しが増えない（永続値を再利用）', async () => {
		// 1回目: 3人を評価（generateObject 3回）
		await evaluateEngagements({
			topicId: 'topic1',
			chapterId: 'ch1',
			personas,
			state: makeState({ turns: [makeTurn('t1')] }),
			chapterTurns: [makeTurn('t1')]
		});
		expect(vi.mocked(generateObject)).toHaveBeenCalledTimes(3);

		// 同一 turnId t1 が永続済みになった状態を再現（ステップ再実行・リトライ相当）
		mockHistoryByPersona = {
			p1: { t1: { score: 3, mode: 'opinion' } },
			p2: { t1: { score: 3, mode: 'opinion' } },
			p3: { t1: { score: 3, mode: 'opinion' } }
		};

		// 2回目: 同一 turnId の再処理 → 再利用で LLM 呼び出しは増えない
		const result = await evaluateEngagements({
			topicId: 'topic1',
			chapterId: 'ch1',
			personas,
			state: makeState({ turns: [makeTurn('t1')] }),
			chapterTurns: [makeTurn('t1')]
		});
		expect(vi.mocked(generateObject)).toHaveBeenCalledTimes(3); // 増えていない
		expect(result).toHaveLength(3);
		expect(result.every((r) => r.score === 3 && r.mode === 'opinion')).toBe(true);
	});
});
