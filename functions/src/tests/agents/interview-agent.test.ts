import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({
	generateText: vi.fn(),
	jsonSchema: (schema: unknown) => schema
}));

vi.mock('@tavily/core', () => ({
	tavily: vi.fn(() => ({ search: vi.fn() }))
}));

vi.mock('../../llm/models.js', () => ({
	getPipelineModel: vi.fn(() => 'mock-model')
}));

vi.mock('../../constants/ai.constants.js', () => ({
	MAX_TOKENS: { INTERVIEW: 4096 }
}));

import type { Persona } from '../../types/persona.types.js';
import type { TopicContext } from '../../types/topic.types.js';

const mockPersona: Persona = {
	id: 'p1',
	topicId: 'topic1',
	name: '田中太郎',
	age: 40,
	occupation: '会社員',
	stakeholderRole: '一般',
	specificRole: '会社員',
	background: '東京在住',
	interests: 'テクノロジー',
	nationality: '日本',
	engagementLevel: 'moderate',
	llmType: 'claude',
	approved: true,
	sortOrder: 0,
	interviewRecord: ''
};

const makeGenerateTextResult = (args: unknown) => ({
	toolCalls: [{ toolName: 'submit_research', args }]
});

describe('interview-agent.runInterview', () => {
	let generateText: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateText = vi.mocked(aiMod.generateText);
		generateText.mockResolvedValue(
			makeGenerateTextResult({
				researchSummary: 'summary',
				interviewRecord: 'record',
				initialBelief: 'belief'
			})
		);
	});

	it('topicContextなしでrunInterviewが成功する（後方互換）', async () => {
		const { runInterview } = await import('../../agents/interview-agent.js');
		const result = await runInterview('AIと社会', mockPersona);
		expect(result.researchSummary).toBe('summary');
		expect(result.initialBelief).toBe('belief');
	});

	it('topicContext.descriptionがあればプロンプトに含める', async () => {
		const capturedMessages: unknown[] = [];
		generateText.mockImplementation(async (args: { messages: unknown[] }) => {
			capturedMessages.push(...args.messages);
			return makeGenerateTextResult({
				researchSummary: 's',
				interviewRecord: 'r',
				initialBelief: 'b'
			});
		});

		const context: TopicContext = { description: 'AIが雇用を代替する問題' };
		const { runInterview } = await import('../../agents/interview-agent.js');
		await runInterview('AIと社会', mockPersona, context);

		const userMessage = capturedMessages.find(
			(m: unknown) => (m as { role: string }).role === 'user'
		) as { content: string };
		expect(userMessage.content).toContain('AIが雇用を代替する問題');
	});

	it('topicContext.sourceContentsがあれば参考資料セクションとしてプロンプトに含める', async () => {
		const capturedMessages: unknown[] = [];
		generateText.mockImplementation(async (args: { messages: unknown[] }) => {
			capturedMessages.push(...args.messages);
			return makeGenerateTextResult({
				researchSummary: 's',
				interviewRecord: 'r',
				initialBelief: 'b'
			});
		});

		const context: TopicContext = { sourceContents: ['記事Aの内容', '記事Bの内容'] };
		const { runInterview } = await import('../../agents/interview-agent.js');
		await runInterview('AIと社会', mockPersona, context);

		const userMessage = capturedMessages.find(
			(m: unknown) => (m as { role: string }).role === 'user'
		) as { content: string };
		expect(userMessage.content).toContain('記事Aの内容');
		expect(userMessage.content).toContain('記事Bの内容');
	});

	it('sourceContentsの各エントリを3000文字で切り詰める', async () => {
		const capturedMessages: unknown[] = [];
		generateText.mockImplementation(async (args: { messages: unknown[] }) => {
			capturedMessages.push(...args.messages);
			return makeGenerateTextResult({
				researchSummary: 's',
				interviewRecord: 'r',
				initialBelief: 'b'
			});
		});

		const longContent = 'x'.repeat(5000);
		const context: TopicContext = { sourceContents: [longContent] };
		const { runInterview } = await import('../../agents/interview-agent.js');
		await runInterview('AIと社会', mockPersona, context);

		const userMessage = capturedMessages.find(
			(m: unknown) => (m as { role: string }).role === 'user'
		) as { content: string };
		expect(userMessage.content).toContain('x'.repeat(3000));
		expect(userMessage.content).not.toContain('x'.repeat(3001));
	});

	it('topicContextがundefinedのとき既存プロンプトと同一', async () => {
		const capturedWithout: unknown[] = [];
		const capturedWith: unknown[] = [];

		generateText.mockImplementation(async (args: { messages: unknown[] }) => {
			capturedWithout.push(...args.messages);
			return makeGenerateTextResult({
				researchSummary: 's',
				interviewRecord: 'r',
				initialBelief: 'b'
			});
		});
		const { runInterview } = await import('../../agents/interview-agent.js');
		await runInterview('AIと社会', mockPersona);
		const withoutContent = (
			capturedWithout.find((m: unknown) => (m as { role: string }).role === 'user') as {
				content: string;
			}
		).content;

		vi.resetModules();
		const aiMod2 = await import('ai');
		const gt2 = vi.mocked(aiMod2.generateText);
		gt2.mockImplementation(async (args: { messages: unknown[] }) => {
			capturedWith.push(...args.messages);
			return makeGenerateTextResult({
				researchSummary: 's',
				interviewRecord: 'r',
				initialBelief: 'b'
			});
		});
		const { runInterview: runInterview2 } = await import('../../agents/interview-agent.js');
		await runInterview2('AIと社会', mockPersona, undefined);
		const withContent = (
			capturedWith.find((m: unknown) => (m as { role: string }).role === 'user') as {
				content: string;
			}
		).content;

		expect(withoutContent).toBe(withContent);
	});
});
