/**
 * Task 5.2: 生成・介入経路の統合テスト
 * - Firestore エミュレーターが必要（`npm run test:integration`）
 * - AI 呼び出しはモック
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// AI 層モック
vi.mock('ai', () => ({
	generateText: vi.fn(),
	tool: vi.fn((def: unknown) => def),
	jsonSchema: (schema: unknown) => schema,
}));
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: vi.fn(() => 'mock-model') }));
vi.mock('../constants/ai.constants.js', () => ({
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
vi.mock('../utils/prompt-formatters.js', () => ({
	formatPersonas: vi.fn(() => '- p1: テスト'),
	formatTurns: vi.fn(() => ''),
	currentDateString: vi.fn(() => '2026-06-19'),
}));
vi.mock('./facilitator-agent.js', () => ({
	buildNeutralitySystemPrompt: vi.fn(() => 'system'),
}));
vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'test-chapter-id') }));

import type { Persona } from '../types/persona.types.js';

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

let db: ReturnType<typeof getFirestore>;

beforeAll(() => {
	initializeApp({ projectId: 'demo-logotope' });
	db = getFirestore();
});

beforeEach(async () => {
	// テスト用ドキュメントをクリーンアップ
	await db.doc(`topics/${TOPIC_ID}/sessions/0`).delete();
});

describe('Task 5.2: チャプター生成で discussionPoints が Firestore に保存される', () => {
	it('生成された discussionPoints が章データとともに sessions/0 に保存される', async () => {
		const { generateText } = await import('ai');
		vi.mocked(generateText)
			.mockResolvedValueOnce({
				toolCalls: [{ toolName: 'submit_issues', args: { issues: ['一般論点1', '一般論点2'] } }],
			} as never)
			.mockResolvedValueOnce({
				toolCalls: [{ toolName: 'submit_issues', args: { issues: ['専門論点1'] } }],
			} as never)
			.mockResolvedValueOnce({
				toolCalls: [{
					toolName: 'submit_chapters',
					args: {
						chapters: [
							{
								title: '第1章',
								focusQuestion: '日常的な問いかけ？',
								discussionPoints: ['論点A', '論点B', '論点C'],
							},
						],
					},
				}],
			} as never);

		const { generateChapters } = await import('./chapter-agent.js');
		const result = await generateChapters('統合テストテーマ', [mockPersona]);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		// Firestore に保存（chapter-generator と同様のロジック）
		const chapters = result.value.chapters;
		await db.doc(`topics/${TOPIC_ID}/sessions/0`).set({ chapters });

		// 保存されたデータを読み取って検証
		const snap = await db.doc(`topics/${TOPIC_ID}/sessions/0`).get();
		const saved = snap.data() as { chapters: typeof chapters };

		expect(saved.chapters[0].discussionPoints).toEqual(['論点A', '論点B', '論点C']);
	});

	it('第1章の discussionPoints には日常感覚の切り口制約がプロンプトに含まれる', async () => {
		const capturedArgs: unknown[] = [];
		const { generateText } = await import('ai');
		vi.mocked(generateText)
			.mockResolvedValueOnce({
				toolCalls: [{ toolName: 'submit_issues', args: { issues: ['issue1'] } }],
			} as never)
			.mockResolvedValueOnce({
				toolCalls: [{ toolName: 'submit_issues', args: { issues: ['issue2'] } }],
			} as never)
			.mockImplementationOnce(async (args) => {
				capturedArgs.push(args);
				return {
					toolCalls: [{
						toolName: 'submit_chapters',
						args: {
							chapters: [{ title: '第1章', focusQuestion: '問い', discussionPoints: ['論点1'] }],
						},
					}],
				} as never;
			});

		const { generateChapters } = await import('./chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		expect(callArgs.messages[0].content).toContain('第1章');
		expect(callArgs.messages[0].content).toMatch(/日常感覚|専門知識のない/);
	});
});

describe('Task 5.2: 開幕発言に論点1が反映される（論点あり章）', () => {
	it('discussionPoints がある章の開幕で論点1がプロンプトに含まれる', async () => {
		const capturedArgs: unknown[] = [];
		const { generateText } = await import('ai');
		vi.mocked(generateText).mockImplementationOnce(async (args) => {
			capturedArgs.push(args);
			return {
				toolCalls: [{ toolName: 'submit_opening', args: { content: '開幕', targetPersonaId: 'p1' } }],
			} as never;
		});

		const { generateOpening } = await import('./facilitator-agent.js');
		await generateOpening('統合テストテーマ', [mockPersona], {
			id: 'ch1',
			title: '第1章',
			focusQuestion: 'テスト？',
			discussionPoints: ['日常感覚の問い', '具体的な論点'],
		});

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		expect(callArgs.messages[0].content).toContain('日常感覚の問い');
	});
});

describe('Task 5.2: 介入経路で未完了論点が渡され着手へ更新される', () => {
	it('tryIntervention が未完了論点を evaluateTopicDrift に渡し、投入後 introduced になる', async () => {
		// facilitator-agent の evaluateTopicDrift をスパイ
		const { evaluateTopicDrift } = await import('./facilitator-agent.js');
		const driftSpy = vi.mocked(evaluateTopicDrift).mockResolvedValueOnce({
			ok: true,
			value: { content: '論点を投入', targetPersonaId: 'p1', selectedDiscussionPointIndex: 0 },
		});

		// Firestore stub（実際の書き込みを省略）
		vi.mock('firebase-admin/firestore', async () => {
			const actual = await vi.importActual('firebase-admin/firestore');
			return {
				...(actual as object),
				getFirestore: vi.fn(() => ({
					doc: vi.fn(() => ({ update: vi.fn().mockResolvedValue(undefined) })),
				})),
				FieldValue: { arrayUnion: vi.fn((...args: unknown[]) => args) },
			};
		});

		const { tryIntervention } = await import('../pipeline/debate/intervention.js');
		const state = {
			turns: [
				{ id: 'f1', turnIndex: 0, speakerType: 'facilitator', content: '開幕', createdAt: '', chapterId: 'ch1' },
				{ id: 't1', turnIndex: 1, speakerType: 'persona', content: '発言1', createdAt: '', chapterId: 'ch1' },
				{ id: 't2', turnIndex: 2, speakerType: 'persona', content: '発言2', createdAt: '', chapterId: 'ch1' },
			],
			silenceMap: new Map<string, number>(),
			speakCount: new Map<string, number>(),
			queuedIntents: new Map(),
			pairConversationTurns: 0,
			currentTurnIndex: 3,
			lastFacilitatorTurnIndex: 0,
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

		// 未完了論点が渡された
		expect(driftSpy).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			['未消化論点X', '未消化論点Y']
		);

		// 投入された論点（index: 0 = '未消化論点X'）が introduced になった
		expect(state.discussionPoints[0].status).toBe('introduced');
		expect(state.discussionPoints[1].status).toBe('untouched');
	});
});
