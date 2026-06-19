import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({
	generateObject: vi.fn(),
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

const makeIssuesResult = (issues: string[]) => ({ object: { issues } });
const makeChaptersResult = (chapters: unknown[] = [
	{ title: '第1章', focusQuestion: '問い1', discussionPoints: ['論点A', '論点B', '論点C'] },
]) => ({ object: { chapters } });

describe('generateChapters - discussionPoints', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
	});

	it('AI が返した discussionPoints を章に含める', async () => {
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['issue1']))
			.mockResolvedValueOnce(makeIssuesResult(['issue2']))
			.mockResolvedValueOnce(makeChaptersResult([
				{ title: '第1章', focusQuestion: '問い1', discussionPoints: ['論点A', '論点B', '論点C'] },
				{ title: '第2章', focusQuestion: '問い2', discussionPoints: ['論点D', '論点E'] },
			]));

		const { generateChapters } = await import('./chapter-agent.js');
		const result = await generateChapters('テストテーマ', [mockPersona]);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.chapters[0].discussionPoints).toEqual(['論点A', '論点B', '論点C']);
			expect(result.value.chapters[1].discussionPoints).toEqual(['論点D', '論点E']);
		}
	});

	it('AI が discussionPoints を返さない場合は空配列でフォールバック', async () => {
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['issue1']))
			.mockResolvedValueOnce(makeIssuesResult(['issue2']))
			.mockResolvedValueOnce(makeChaptersResult([
				{ title: '第1章', focusQuestion: '問い1', discussionPoints: [] },
			]));

		const { generateChapters } = await import('./chapter-agent.js');
		const result = await generateChapters('テストテーマ', [mockPersona]);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.chapters[0].discussionPoints).toEqual([]);
		}
	});

	it('章生成プロンプトに第1章の日常感覚制約が含まれる', async () => {
		const capturedArgs: unknown[] = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['i1']))
			.mockResolvedValueOnce(makeIssuesResult(['i2']))
			.mockImplementationOnce(async (args: unknown) => {
				capturedArgs.push(args);
				return makeChaptersResult();
			});

		const { generateChapters } = await import('./chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		const content = callArgs.messages[0].content;
		expect(content).toContain('第1章');
		expect(content).toMatch(/日常感覚|専門知識のない/);
	});
});

describe('generateChapters - topicContext対応', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	const mockIssues = (issues: string[]) => makeIssuesResult(issues);
	const mockChapters = () => makeChaptersResult();

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
	});

	it('topicContext.descriptionをgeneralIssuesプロンプトに含める', async () => {
		const capturedGeneralIssues: unknown[] = [];
		generateObject
			.mockImplementationOnce(async (args: { messages: unknown[] }) => {
				capturedGeneralIssues.push(...args.messages);
				return mockIssues(['i1']);
			})
			.mockResolvedValueOnce(mockIssues(['i2']))
			.mockResolvedValueOnce(mockChapters());

		const { generateChapters } = await import('./chapter-agent.js');
		await generateChapters('テーマ', [mockPersona], { description: 'テーマの詳細説明テキスト' });

		const msg = capturedGeneralIssues.find((m: unknown) => (m as { role: string }).role === 'user') as { content: string };
		expect(msg.content).toContain('テーマの詳細説明テキスト');
	});

	it('topicContext.descriptionをpersonaIssuesプロンプトに含める', async () => {
		const capturedPersonaIssues: unknown[] = [];
		generateObject
			.mockResolvedValueOnce(mockIssues(['i1']))
			.mockImplementationOnce(async (args: { messages: unknown[] }) => {
				capturedPersonaIssues.push(...args.messages);
				return mockIssues(['i2']);
			})
			.mockResolvedValueOnce(mockChapters());

		const { generateChapters } = await import('./chapter-agent.js');
		await generateChapters('テーマ', [mockPersona], { description: 'ペルソナ向け詳細説明' });

		const msg = capturedPersonaIssues.find((m: unknown) => (m as { role: string }).role === 'user') as { content: string };
		expect(msg.content).toContain('ペルソナ向け詳細説明');
	});

	it('topicContext.sourceContentsをgeneralIssuesプロンプトに含める', async () => {
		const capturedGeneralIssues: unknown[] = [];
		generateObject
			.mockImplementationOnce(async (args: { messages: unknown[] }) => {
				capturedGeneralIssues.push(...args.messages);
				return mockIssues(['i1']);
			})
			.mockResolvedValueOnce(mockIssues(['i2']))
			.mockResolvedValueOnce(mockChapters());

		const { generateChapters } = await import('./chapter-agent.js');
		await generateChapters('テーマ', [mockPersona], { sourceContents: ['参考記事のテキスト'] });

		const msg = capturedGeneralIssues.find((m: unknown) => (m as { role: string }).role === 'user') as { content: string };
		expect(msg.content).toContain('参考記事のテキスト');
	});

	it('topicContextなしで既存プロンプトと同一動作（後方互換）', async () => {
		const capturedWith: unknown[] = [];
		const capturedWithout: unknown[] = [];

		generateObject.mockImplementation(async (args: { messages: unknown[] }) => {
			capturedWithout.push(...args.messages);
			const calls = generateObject.mock.calls.length;
			if (calls <= 2) return mockIssues(['i']);
			return mockChapters();
		});
		const { generateChapters } = await import('./chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);
		const contentWithout = (capturedWithout.find((m: unknown) => (m as { role: string }).role === 'user') as { content: string }).content;

		vi.resetModules();
		const aiMod2 = await import('ai');
		const go2 = vi.mocked(aiMod2.generateObject);
		go2.mockImplementation(async (args: { messages: unknown[] }) => {
			capturedWith.push(...args.messages);
			const calls = go2.mock.calls.length;
			if (calls <= 2) return mockIssues(['i']);
			return mockChapters();
		});
		const { generateChapters: gc2 } = await import('./chapter-agent.js');
		await gc2('テーマ', [mockPersona], undefined);
		const contentWith = (capturedWith.find((m: unknown) => (m as { role: string }).role === 'user') as { content: string }).content;

		expect(contentWithout).toBe(contentWith);
	});

	it('chaptersプロンプトにはtopicContextを含めない', async () => {
		const capturedChapters: unknown[] = [];
		generateObject
			.mockResolvedValueOnce(mockIssues(['i1']))
			.mockResolvedValueOnce(mockIssues(['i2']))
			.mockImplementationOnce(async (args: { messages: unknown[] }) => {
				capturedChapters.push(...args.messages);
				return mockChapters();
			});

		const { generateChapters } = await import('./chapter-agent.js');
		await generateChapters('テーマ', [mockPersona], { description: 'この説明はchaptersプロンプトに含まない' });

		const msg = capturedChapters.find((m: unknown) => (m as { role: string }).role === 'user') as { content: string };
		expect(msg.content).not.toContain('この説明はchaptersプロンプトに含まない');
	});
});
