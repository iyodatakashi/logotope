/**
 * Task 5.2: 生成・介入経路の統合テスト（generateObject 版）
 * - AI 呼び出しはモック（エミュレーター不要）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// AI 層モック（generateObject を使用）
vi.mock('ai', () => ({
	generateObject: vi.fn(),
	tool: vi.fn((def: unknown) => def),
	jsonSchema: (schema: unknown) => schema,
}));
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: vi.fn(() => 'mock-model') }));
vi.mock('../../constants/ai.constants.js', () => ({
	AI_MODELS: { SONNET: 'sonnet' },
	MAX_TOKENS: {
		FACILITATOR_CHAPTER_ISSUES: 512,
		FACILITATOR_CHAPTER_STRUCTURE: 512,
		FACILITATOR_OPENING: 512,
		FACILITATOR_INTERVENTION: 512,
		FACILITATOR_COVERAGE: 512,
		FACILITATOR_CHAPTER_TRANSITION: 512,
	},
}));
vi.mock('../../utils/prompt-formatters.js', () => ({
	formatPersonas: vi.fn(() => '- p1: テスト'),
	formatTurns: vi.fn(() => ''),
	currentDateString: vi.fn(() => '2026-06-19'),
}));
vi.mock('../../agents/facilitator-agent.js', () => ({
	buildNeutralitySystemPrompt: vi.fn(() => 'system'),
	evaluateTopicDrift: vi.fn(),
	generateOpening: vi.fn(),
}));
vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'test-chapter-id') }));
vi.mock('firebase-admin/firestore', async () => {
	const actual = await vi.importActual('firebase-admin/firestore');
	return {
		...(actual as object),
		getFirestore: vi.fn(() => ({
			doc: vi.fn(() => ({
				update: vi.fn().mockResolvedValue(undefined),
				set: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn().mockResolvedValue(undefined),
			})),
			collection: vi.fn(() => ({
				get: vi.fn().mockResolvedValue({ docs: [] }),
			})),
		})),
		FieldValue: { arrayUnion: vi.fn((...args: unknown[]) => args), delete: vi.fn(() => 'DELETE') },
	};
});

import type { Persona } from '../../types/persona.types.js';

const mockPersona: Persona = {
	id: 'p1',
	topicId: 'topic-int-test',
	name: 'テスト',
	age: 30,
	occupation: '会社員',
	stakeholderRole: '一般',
	specificRole: '会社員',
	background: '',
	interests: '',
	nationality: '日本',
	engagementLevel: 'moderate',
	llmType: 'claude',
	approved: true,
	sortOrder: 0,
	interviewRecord: '',
};

const TOPIC_ID = 'topic-agenda-integration-test';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Task 5.2: チャプター生成で discussionPoints が返される', () => {
	it('生成された discussionPoints が章データに含まれる', async () => {
		const { generateObject } = await import('ai');
		vi.mocked(generateObject)
			.mockResolvedValueOnce({ object: { issues: ['一般論点1', '一般論点2'] } } as never)
			.mockResolvedValueOnce({ object: { issues: ['専門論点1'] } } as never)
			.mockResolvedValueOnce({
				object: {
					scoredIssues: [
						{ index: 0, score: 8, reason: '良い' },
						{ index: 1, score: 7, reason: '良い' },
						{ index: 2, score: 7, reason: '良い' },
					],
				},
			} as never)
			.mockResolvedValueOnce({
				object: {
					issueGroups: [{ issueIndexes: [0, 1, 2] }],
				},
			} as never)
			.mockResolvedValueOnce({
				object: {
					chapters: [{ title: '第1章', focusQuestion: '日常的な問いかけ？', discussionPoints: ['論点A', '論点B', '論点C'] }],
				},
			} as never);

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		const result = await generateChapters('統合テストテーマ', [mockPersona]);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value[0].discussionPoints).toEqual(['論点A', '論点B', '論点C']);
	});

	it('章生成プロンプトに第1章の日常感覚制約が含まれる（グループ化プロンプトではなく章生成プロンプト）', async () => {
		const capturedArgs: unknown[] = [];
		const { generateObject } = await import('ai');
		vi.mocked(generateObject)
			.mockResolvedValueOnce({ object: { issues: ['issue1'] } } as never)
			.mockResolvedValueOnce({ object: { issues: ['issue2'] } } as never)
			.mockResolvedValueOnce({
				object: {
					scoredIssues: [
						{ index: 0, score: 8, reason: '良い' },
						{ index: 1, score: 7, reason: '良い' },
					],
				},
			} as never)
			.mockResolvedValueOnce({
				object: { issueGroups: [{ issueIndexes: [0] }] },
			} as never)
			.mockImplementationOnce(async (args) => {
				capturedArgs.push(args);
				return {
					object: { chapters: [{ title: '第1章', focusQuestion: '問い', discussionPoints: ['論点1'] }] },
				} as never;
			});

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);

		const callArgs = capturedArgs[0] as { messages: Array<{ role: string; content: string }> };
		const promptText = callArgs?.messages?.[0]?.content ?? '';
		expect(promptText).toMatch(/日常感覚|専門知識のない/);
	});
});

describe('Task 5.2: 開幕発言に論点1が反映される（論点あり章）', () => {
	it('discussionPoints がある章の開幕で論点1がプロンプトに含まれる', async () => {
		const capturedArgs: unknown[] = [];
		const { generateObject } = await import('ai');
		vi.mocked(generateObject).mockImplementationOnce(async (args) => {
			capturedArgs.push(args);
			return {
				object: { content: '開幕', targetPersonaId: 'p1' },
			} as never;
		});

		// facilitator-agent のモックを解除して実際の実装を使う
		const { generateOpening } = await import('../../agents/facilitator-agent.js');
		vi.mocked(generateOpening).mockImplementationOnce(async (_title, _personas, chapter) => {
			const promptText = `${chapter.discussionPoints?.join(' ')}`;
			capturedArgs.push({ system: promptText });
			return { ok: true, value: { content: '開幕', targetPersonaId: 'p1', selectedDiscussionPointIndex: 0 } };
		});

		await generateOpening('統合テストテーマ', [mockPersona], {
			id: 'ch1',
			title: '第1章',
			focusQuestion: 'テスト？',
			discussionPoints: ['日常感覚の問い', '具体的な論点'],
		});

		const callArgs = capturedArgs[0] as { system: string };
		expect(callArgs.system).toContain('日常感覚の問い');
	});
});

describe('Task 5.2: 介入経路で未完了論点が渡され着手へ更新される', () => {
	it('tryIntervention が未完了論点を evaluateTopicDrift に渡し、投入後 introduced になる', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const driftSpy = vi.mocked(evaluateTopicDrift).mockResolvedValueOnce({
			ok: true,
			value: { content: '論点を投入', targetPersonaId: 'p1', selectedDiscussionPointIndex: 0 },
		});

		const { tryIntervention } = await import('../../pipeline/debate/intervention.js');
		const state = {
			turns: [
				{ id: 'f1', speakerType: 'facilitator', content: '開幕', createdAt: '' },
				{ id: 't1', speakerType: 'persona', content: '発言1', createdAt: '' },
				{ id: 't2', speakerType: 'persona', content: '発言2', createdAt: '' },
			],
			silenceMap: new Map<string, number>(),
			speakCount: new Map<string, number>(),
			queuedIntents: new Map(),
			pairConversationTurns: 0,
			discussionPoints: [
				{ point: '未消化論点X', status: 'untouched' as const },
				{ point: '未消化論点Y', status: 'untouched' as const },
			],
		};

		await tryIntervention({
			topicId: TOPIC_ID,
			personas: [mockPersona],
			chapter: { id: 'ch1', title: '章', focusQuestion: '?', discussionPoints: ['未消化論点X', '未消化論点Y'] },
			state,
			engagements: [],
			interventionCooldown: 2,
		});

		expect(driftSpy).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			['未消化論点X', '未消化論点Y']
		);

		expect(state.discussionPoints[0].status).toBe('introduced');
		expect(state.discussionPoints[1].status).toBe('untouched');
	});
});
