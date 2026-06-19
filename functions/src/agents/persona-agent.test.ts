import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Persona } from '../types/persona.types.js';
import type { DebateTurn, Engagement, TurnGenerationContext } from '../types/debate.types.js';
import type { Chapter } from '../types/chapter.types.js';

vi.mock('ai', () => ({
	generateText: vi.fn(),
	jsonSchema: (schema: unknown) => schema,
}));

vi.mock('../llm/models.js', () => ({
	getPersonaModel: vi.fn(() => 'mock-model'),
}));

vi.mock('../search/search-service.js', () => ({
	isSearchAvailable: vi.fn(() => false),
	executeSearch: vi.fn(),
}));

vi.mock('../utils/prompt-formatters.js', () => ({
	formatTurns: vi.fn(() => '【過去の発言なし】'),
	currentDateString: vi.fn(() => '2026-06-19'),
}));

const mockPersona: Persona = {
	id: 'p1',
	topicId: 'topic1',
	name: '田中太郎',
	age: 40,
	occupation: '会社員',
	stakeholderRole: '一般市民',
	specificRole: '会社員',
	background: 'テスト背景',
	interests: 'テスト関心事',
	nationality: '日本',
	engagementLevel: 'moderate',
	llmType: 'claude',
	approved: true,
	sortOrder: 0,
	interviewRecord: 'テスト取材記録',
};

const mockChapter: Chapter = {
	id: 'ch1',
	title: 'テスト章',
	focusQuestion: 'テスト質問？',
};

const mockTurns: DebateTurn[] = [];

describe('ASSESS_ENGAGEMENT_TOOLS', () => {
	it('mode の enum に question が含まれる', async () => {
		const { ASSESS_ENGAGEMENT_TOOLS } = await import('./persona-agent.js');
		const modeEnum =
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(ASSESS_ENGAGEMENT_TOOLS as any).assess_engagement.parameters.properties.mode.enum;
		expect(modeEnum).toContain('question');
	});

	it('mode の enum に fact, opinion, none も含まれる', async () => {
		const { ASSESS_ENGAGEMENT_TOOLS } = await import('./persona-agent.js');
		const modeEnum =
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(ASSESS_ENGAGEMENT_TOOLS as any).assess_engagement.parameters.properties.mode.enum;
		expect(modeEnum).toContain('fact');
		expect(modeEnum).toContain('opinion');
		expect(modeEnum).toContain('none');
	});
});

describe('evaluateEngagement', () => {
	let generateText: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateText = vi.mocked(aiMod.generateText);
	});

	it('mode: question かつ intentSummary が空の場合、mode: opinion に正規化して返す', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateText).mockResolvedValueOnce({
			toolCalls: [
				{
					toolName: 'assess_engagement',
					args: { score: 4, mode: 'question', intentSummary: '' },
				},
			],
		} as never);

		const { evaluateEngagement } = await import('./persona-agent.js');
		const result = await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子', '鈴木次郎']);

		expect(result.mode).toBe('opinion');
		expect(result.score).toBe(4);
	});

	it('mode: question かつ intentSummary が未設定の場合、mode: opinion に正規化して返す', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateText).mockResolvedValueOnce({
			toolCalls: [
				{
					toolName: 'assess_engagement',
					args: { score: 3, mode: 'question' },
				},
			],
		} as never);

		const { evaluateEngagement } = await import('./persona-agent.js');
		const result = await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子']);

		expect(result.mode).toBe('opinion');
	});

	it('mode: question かつ intentSummary が非空の場合、そのまま mode: question を返す', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateText).mockResolvedValueOnce({
			toolCalls: [
				{
					toolName: 'assess_engagement',
					args: { score: 4, mode: 'question', intentSummary: '佐藤さんの根拠を聞きたい' },
				},
			],
		} as never);

		const { evaluateEngagement } = await import('./persona-agent.js');
		const result = await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子']);

		expect(result.mode).toBe('question');
		expect(result.intentSummary).toBe('佐藤さんの根拠を聞きたい');
	});

	it('otherPersonaNames がプロンプトに含まれる', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementationOnce(async (args) => {
			capturedArgs.push(args);
			return {
				toolCalls: [
					{
						toolName: 'assess_engagement',
						args: { score: 2, mode: 'opinion', intentSummary: 'テスト' },
					},
				],
			} as never;
		});

		const { evaluateEngagement } = await import('./persona-agent.js');
		await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子', '鈴木次郎']);

		const callArgs = capturedArgs[0] as { messages: Array<{ role: string; content: string }> };
		const userContent = callArgs.messages[0].content;
		expect(userContent).toContain('佐藤花子');
		expect(userContent).toContain('鈴木次郎');
	});

	void generateText;
});

describe('generateTurn', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	const makeContext = (extras?: Partial<TurnGenerationContext>): TurnGenerationContext => ({
		chapterTurns: [],
		chapter: mockChapter,
		otherPersonas: [
			{ id: 'p2', name: '佐藤花子' },
			{ id: 'p3', name: '鈴木次郎' },
		],
		...extras,
	});

	const makeEngagement = (override?: Partial<Engagement>): Engagement => ({
		personaId: 'p1',
		score: 4,
		mode: 'question',
		intentSummary: '佐藤さんの意見の根拠を確認したい',
		...override,
	});

	it('question モードのとき questionInstruction がプロンプトに含まれる', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return {
				steps: [
					{
						toolCalls: [
							{
								toolName: 'submit_turn',
								args: { content: '佐藤さん、なぜそう思うんですか？' },
							},
						],
					},
				],
			} as never;
		});

		const { generateTurn } = await import('./persona-agent.js');
		const result = await generateTurn(mockPersona, makeContext(), makeEngagement());

		expect(result.ok).toBe(true);
		const callArgs = capturedArgs[0] as { messages: Array<{ role: string; content: string }> };
		const userContent = callArgs.messages[0].content;
		expect(userContent).toContain('佐藤さんの意見の根拠を確認したい');
		expect(userContent).toContain('targetPersonaId');
	});

	it('question モードのとき speechMode: question を返す', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateText).mockResolvedValue({
			steps: [
				{
					toolCalls: [
						{
							toolName: 'submit_turn',
							args: { content: '佐藤さん、なぜそう思うんですか？', targetPersonaId: 'p2' },
						},
					],
				},
			],
		} as never);

		const { generateTurn } = await import('./persona-agent.js');
		const result = await generateTurn(mockPersona, makeContext(), makeEngagement());

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.speechMode).toBe('question');
		}
	});

	it('opinion モードのとき questionInstruction はプロンプトに含まれない', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return {
				steps: [
					{
						toolCalls: [{ toolName: 'submit_turn', args: { content: 'テスト発言' } }],
					},
				],
			} as never;
		});

		const { generateTurn } = await import('./persona-agent.js');
		await generateTurn(
			mockPersona,
			makeContext(),
			makeEngagement({ mode: 'opinion', intentSummary: '意見を述べたい' })
		);

		const callArgs = capturedArgs[0] as { messages: Array<{ role: string; content: string }> };
		const userContent = callArgs.messages[0].content;
		// intentSummary is still included via intentNote but no targetPersonaId mandate
		expect(userContent).not.toContain('必ず targetPersonaId に質問相手のIDを指定');
	});

	it('otherPersonas が context にある場合、参加者の名前とIDがプロンプトに含まれる', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return {
				steps: [
					{
						toolCalls: [
							{
								toolName: 'submit_turn',
								args: { content: 'テスト', targetPersonaId: 'p2' },
							},
						],
					},
				],
			} as never;
		});

		const { generateTurn } = await import('./persona-agent.js');
		await generateTurn(mockPersona, makeContext(), makeEngagement());

		const callArgs = capturedArgs[0] as { messages: Array<{ role: string; content: string }> };
		const userContent = callArgs.messages[0].content;
		expect(userContent).toContain('佐藤花子');
		expect(userContent).toContain('p2');
	});
});
