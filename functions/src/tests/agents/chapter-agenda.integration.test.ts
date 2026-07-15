/**
 * Task 5.2: 生成・介入経路の統合テスト（generateObject 版）
 * - AI 呼び出しはモック（エミュレーター不要）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// AI 層モック（generateObject を使用）
vi.mock('ai', () => ({
	generateObject: vi.fn(),
	tool: vi.fn((def: unknown) => def),
	jsonSchema: (schema: unknown) => schema
}));
vi.mock('../../llm/models.js', () => ({ sonnet: 'mock-model' }));
vi.mock('../../constants/ai.constants.js', () => ({
	AI_MODELS: { SONNET: 'sonnet' },
	MAX_TOKENS: {
		FACILITATOR_CHAPTER_ISSUES: 512,
		FACILITATOR_CHAPTER_STRUCTURE: 512,
		FACILITATOR_OPENING: 512,
		FACILITATOR_INTERVENTION: 512,
		FACILITATOR_COVERAGE: 512,
		FACILITATOR_CHAPTER_TRANSITION: 512
	}
}));
vi.mock('../../utils/prompt-formatters.js', () => ({
	formatPersonas: vi.fn(() => '- p1: テスト'),
	formatTurns: vi.fn(() => ''),
	currentDateString: vi.fn(() => '2026-06-19')
}));
vi.mock('../../agents/facilitator-agent.js', () => ({
	buildNeutralitySystemPrompt: vi.fn(() => 'system'),
	assessActiveAgendaItem: vi.fn(),
	generateInterventionUtterance: vi.fn(),
	generateOpening: vi.fn()
}));
vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'test-chapter-id') }));
vi.mock('firebase-admin/firestore', async () => {
	const actual = await vi.importActual('firebase-admin/firestore');
	return {
		...(actual as object),
		getFirestore: vi.fn(() => ({
			doc: vi.fn(() => ({
				get: vi.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
				update: vi.fn().mockResolvedValue(undefined),
				set: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn().mockResolvedValue(undefined)
			})),
			collection: vi.fn(() => ({
				get: vi.fn().mockResolvedValue({ docs: [] })
			})),
			runTransaction: vi.fn(
				async (fn: (tx: { get: typeof vi.fn; update: typeof vi.fn }) => Promise<unknown>) =>
					fn({
						get: vi.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
						update: vi.fn()
					} as never)
			)
		})),
		FieldValue: { arrayUnion: vi.fn((...args: unknown[]) => args), delete: vi.fn(() => 'DELETE') }
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
	selected: true,
	sortOrder: 0,
	interviewRecord: ''
};

const TOPIC_ID = 'topic-agenda-integration-test';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Task 5.2: チャプター生成で agenda が返される', () => {
	it('生成された agenda が章データに含まれる', async () => {
		const { generateObject } = await import('ai');
		vi.mocked(generateObject)
			.mockResolvedValueOnce({ object: { issues: ['一般論点1', '一般論点2'] } } as never)
			.mockResolvedValueOnce({ object: { issues: ['専門論点1'] } } as never)
			.mockResolvedValueOnce({
				object: {
					scoredIssues: [
						{ index: 0, score: 8, reason: '良い' },
						{ index: 1, score: 7, reason: '良い' },
						{ index: 2, score: 7, reason: '良い' }
					]
				}
			} as never)
			.mockResolvedValueOnce({ object: { duplicateGroups: [] } } as never)
			.mockResolvedValueOnce({
				object: {
					issueGroups: [{ issueIndexes: [0, 1, 2] }]
				}
			} as never)
			.mockResolvedValueOnce({
				object: {
					chapters: [
						{
							title: '第1章',
							agenda: ['論点A', '論点B', '論点C']
						}
					]
				}
			} as never);

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		const result = await generateChapters('統合テストテーマ', [mockPersona]);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value[0].agenda).toEqual(['論点A', '論点B', '論点C']);
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
						{ index: 1, score: 7, reason: '良い' }
					]
				}
			} as never)
			.mockResolvedValueOnce({ object: { duplicateGroups: [] } } as never)
			.mockResolvedValueOnce({
				object: { issueGroups: [{ issueIndexes: [0] }] }
			} as never)
			.mockImplementationOnce(async (args) => {
				capturedArgs.push(args);
				return {
					object: {
						chapters: [{ title: '第1章', agenda: ['論点1'] }]
					}
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
	it('agenda がある章の開幕で論点1がプロンプトに含まれる', async () => {
		const capturedArgs: unknown[] = [];
		const { generateObject } = await import('ai');
		vi.mocked(generateObject).mockImplementationOnce(async (args) => {
			capturedArgs.push(args);
			return {
				object: { content: '開幕', targetPersonaId: 'p1' }
			} as never;
		});

		// facilitator-agent のモックを解除して実際の実装を使う
		const { generateOpening } = await import('../../agents/facilitator-agent.js');
		vi.mocked(generateOpening).mockImplementationOnce(async (_title, _personas, chapter) => {
			const promptText = `${chapter.agenda?.join(' ')}`;
			capturedArgs.push({ system: promptText });
			return {
				ok: true,
				value: { content: '開幕', targetPersonaId: 'p1', selectedAgendaItemIndex: 0 }
			};
		});

		await generateOpening('統合テストテーマ', [mockPersona], {
			id: 'ch1',
			title: '第1章',
			agenda: ['日常感覚の問い', '具体的な論点']
		});

		const callArgs = capturedArgs[0] as { system: string };
		expect(callArgs.system).toContain('日常感覚の問い');
	});
});

describe('Task 5.2: 介入経路で未提示論点が渡され introduced へ更新される', () => {
	it('progressAgenda が未提示論点を introduce 行動へ渡し、投入後 introduced になる', async () => {
		const { assessActiveAgendaItem, generateInterventionUtterance } = await import(
			'../../agents/facilitator-agent.js'
		);
		const assessSpy = vi
			.mocked(assessActiveAgendaItem)
			.mockResolvedValueOnce({ ok: true, value: { verdict: 'exhausted' } });
		const utterSpy = vi.mocked(generateInterventionUtterance).mockResolvedValueOnce({
			ok: true,
			value: { content: '論点を投入', targetPersonaId: 'p1', selectedAgendaItemIndex: 0 }
		});

		const { progressAgenda } = await import('../../pipeline/debate/intervention.js');
		const state = {
			turns: [
				{ id: 'f1', speakerType: 'facilitator', content: '開幕', createdAt: '' },
				{ id: 't1', speakerType: 'persona', content: '発言1', createdAt: '' },
				{ id: 't2', speakerType: 'persona', content: '発言2', createdAt: '' }
			],
			silenceMap: new Map<string, number>(),
			speakCount: new Map<string, number>(),
			queuedIntents: new Map(),
			agenda: [
				{ point: '未消化論点X', status: 'untouched' as const },
				{ point: '未消化論点Y', status: 'untouched' as const }
			]
		};

		await progressAgenda({
			topicId: TOPIC_ID,
			personas: [mockPersona],
			chapter: {
				id: 'ch1',
				title: '章',
				agenda: ['未消化論点X', '未消化論点Y']
			},
			chapterId: 'ch1',
			state,
			engagements: [],
			interventionCooldown: 2
		});

		// 判定は introduced 不在のため章タイトル '章' を判断軸にする
		expect(assessSpy).toHaveBeenCalledWith('章', expect.anything(), expect.anything());
		// introduce 行動には未提示論点リストが渡る
		expect(utterSpy).toHaveBeenCalledWith(
			{ kind: 'introduce', untouchedAgendaItems: ['未消化論点X', '未消化論点Y'] },
			expect.anything(),
			expect.anything(),
			expect.anything()
		);

		expect(state.agenda[0].status).toBe('introduced');
		expect(state.agenda[1].status).toBe('untouched');
	});
});
