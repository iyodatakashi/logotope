import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({
	generateText: vi.fn(),
	tool: vi.fn((def: unknown) => def),
	jsonSchema: (schema: unknown) => schema,
}));

vi.mock('@ai-sdk/anthropic', () => ({
	anthropic: vi.fn(() => 'mock-model'),
}));

vi.mock('../constants/ai.constants.js', () => ({
	AI_MODELS: { SONNET: 'sonnet' },
	MAX_TOKENS: {
		FACILITATOR_CHAPTER_ISSUES: 1024,
		FACILITATOR_CHAPTER_STRUCTURE: 2048,
	},
}));

vi.mock('../utils/prompt-formatters.js', () => ({
	formatPersonas: vi.fn(() => '- p1: テスト'),
	currentDateString: vi.fn(() => '2026-06-19'),
}));

vi.mock('./facilitator-agent.js', () => ({
	buildNeutralitySystemPrompt: vi.fn(() => 'system prompt'),
}));

vi.mock('nanoid', () => ({
	nanoid: vi.fn(() => 'test-id'),
}));

import type { Persona } from '../types/persona.types.js';

const mockPersona: Persona = {
	id: 'p1',
	topicId: 'topic1',
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

const makeGenerateTextResult = (toolName: string, args: unknown) => ({
	toolCalls: [{ toolName, args }],
});

describe('SUBMIT_CHAPTERS_TOOL スキーマ', () => {
	it('discussionPoints フィールドが schema に含まれる', async () => {
		const { SUBMIT_CHAPTERS_TOOL } = await import('./chapter-agent.js');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const itemProps = (SUBMIT_CHAPTERS_TOOL as any).parameters.properties.chapters.items.properties;
		expect(itemProps).toHaveProperty('discussionPoints');
		expect(itemProps.discussionPoints.type).toBe('array');
	});

	it('discussionPoints が required に含まれる', async () => {
		const { SUBMIT_CHAPTERS_TOOL } = await import('./chapter-agent.js');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const required = (SUBMIT_CHAPTERS_TOOL as any).parameters.properties.chapters.items.required as string[];
		expect(required).toContain('discussionPoints');
	});
});

describe('generateChapters - discussionPoints', () => {
	let generateText: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateText = vi.mocked(aiMod.generateText);
	});

	it('AI が返した discussionPoints を章に含める', async () => {
		generateText.mockResolvedValueOnce(makeGenerateTextResult('submit_issues', { issues: ['issue1'] }));
		generateText.mockResolvedValueOnce(makeGenerateTextResult('submit_issues', { issues: ['issue2'] }));
		generateText.mockResolvedValueOnce(
			makeGenerateTextResult('submit_chapters', {
				chapters: [
					{ title: '第1章', focusQuestion: '問い1', discussionPoints: ['論点A', '論点B', '論点C'] },
					{ title: '第2章', focusQuestion: '問い2', discussionPoints: ['論点D', '論点E'] },
				],
			})
		);

		const { generateChapters } = await import('./chapter-agent.js');
		const result = await generateChapters('テストテーマ', [mockPersona]);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.chapters[0].discussionPoints).toEqual(['論点A', '論点B', '論点C']);
			expect(result.value.chapters[1].discussionPoints).toEqual(['論点D', '論点E']);
		}
	});

	it('AI が discussionPoints を返さない場合は空配列でフォールバック', async () => {
		generateText.mockResolvedValueOnce(makeGenerateTextResult('submit_issues', { issues: ['issue1'] }));
		generateText.mockResolvedValueOnce(makeGenerateTextResult('submit_issues', { issues: ['issue2'] }));
		generateText.mockResolvedValueOnce(
			makeGenerateTextResult('submit_chapters', {
				chapters: [{ title: '第1章', focusQuestion: '問い1' }],
			})
		);

		const { generateChapters } = await import('./chapter-agent.js');
		const result = await generateChapters('テストテーマ', [mockPersona]);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.chapters[0].discussionPoints).toEqual([]);
		}
	});

	it('章生成プロンプトに第1章の日常感覚制約が含まれる', async () => {
		const capturedArgs: unknown[] = [];
		generateText.mockResolvedValueOnce(makeGenerateTextResult('submit_issues', { issues: ['i1'] }));
		generateText.mockResolvedValueOnce(makeGenerateTextResult('submit_issues', { issues: ['i2'] }));
		generateText.mockImplementationOnce(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult('submit_chapters', {
				chapters: [{ title: '第1章', focusQuestion: '問い', discussionPoints: ['論点1'] }],
			});
		});

		const { generateChapters } = await import('./chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		const content = callArgs.messages[0].content;
		expect(content).toContain('第1章');
		expect(content).toMatch(/日常感覚|専門知識のない/);
	});
});
