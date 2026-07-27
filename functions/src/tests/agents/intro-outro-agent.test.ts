import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DebateDigest } from '../../types/debate-digest.types.js';
import type { TopicContext } from '../../types/topic.types.js';
import type { IntroOutroInput } from '../../agents/intro-outro-agent.js';

vi.mock('ai', () => ({
	generateText: vi.fn()
}));

vi.mock('../../llm/models.js', () => ({
	sonnet: 'mock-model'
}));

vi.mock('../../constants/ai.constants.js', () => ({
	AI_MODELS: { SONNET: 'sonnet' }
}));

const mockDigest: DebateDigest = {
	topicTitle: 'リモートワークの是非',
	chapters: [
		{
			title: '第1章 働き方の変化',
			agenda: ['生産性', '孤独感'],
			summary: '生産性の向上と孤独感の増大の双方の立場が示された。'
		}
	],
	personas: [
		{ personaId: 'p1', name: '田中', stance: '推進派', beliefShifts: ['対面の価値も再認識'] },
		{ personaId: 'p2', name: '佐藤', stance: '慎重派', beliefShifts: [] }
	]
};

const mockTopicContext: TopicContext = {
	description: 'コロナ後の働き方',
	sourceContents: ['参考資料本文']
};

const mockInput: IntroOutroInput = { digest: mockDigest, topicContext: mockTopicContext };

describe('generateIntro / generateOutro', () => {
	let generateText: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		const aiMod = await import('ai');
		generateText = vi.mocked(aiMod.generateText);
	});

	it('generateIntro は非空の散文を返す', async () => {
		generateText.mockResolvedValueOnce({
			text: 'この討論は、リモートワークをめぐる問いから始まる。'
		});

		const { generateIntro } = await import('../../agents/intro-outro-agent.js');
		const result = await generateIntro(mockInput);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.length).toBeGreaterThan(0);
			expect(result.value).toBe('この討論は、リモートワークをめぐる問いから始まる。');
		}
	});

	it('generateOutro は非空の散文を返す', async () => {
		generateText.mockResolvedValueOnce({ text: '論点は交わされ、問いはなお開かれたままである。' });

		const { generateOutro } = await import('../../agents/intro-outro-agent.js');
		const result = await generateOutro(mockInput);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe('論点は交わされ、問いはなお開かれたままである。');
		}
	});

	it('システムプロンプトが非結論・非支持・です・ます調を強制する', async () => {
		const capturedArgs: unknown[] = [];
		generateText.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return { text: '導入文' };
		});

		const { generateIntro } = await import('../../agents/intro-outro-agent.js');
		await generateIntro(mockInput);

		const callArgs = capturedArgs[0] as { system: string; messages: Array<{ content: string }> };
		expect(callArgs.system).toMatch(/結論|優劣|勝敗/);
		expect(callArgs.system).toMatch(/支持|否定/);
		expect(callArgs.system).toMatch(/です・ます/);
	});

	it('イントロ入力はテーマと論点の骨子のみで、ネタバレ（章要約・立場・信念変化）を含まない', async () => {
		const capturedArgs: unknown[] = [];
		generateText.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return { text: '導入文' };
		});

		const { generateIntro } = await import('../../agents/intro-outro-agent.js');
		await generateIntro(mockInput);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		const userContent = callArgs.messages[0].content;
		// テーマと論点（読者に提示してよい問い）は含む
		expect(userContent).toContain('リモートワークの是非');
		expect(userContent).toContain('生産性');
		expect(userContent).toContain('孤独感');
		// ネタバレ源（章要約・立場・信念変化）は渡さない
		expect(userContent).not.toContain('生産性の向上と孤独感の増大');
		expect(userContent).not.toContain('推進派');
		expect(userContent).not.toContain('対面の価値も再認識');
	});

	it('アウトロ入力は討論内容（章要約・立場・信念変化）を含み、結びを討論に接地させる', async () => {
		const capturedArgs: unknown[] = [];
		generateText.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return { text: '結び' };
		});

		const { generateOutro } = await import('../../agents/intro-outro-agent.js');
		await generateOutro(mockInput);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		const userContent = callArgs.messages[0].content;
		// 討論に即した問いを選べるよう、章要約・立場・信念変化まで渡す
		expect(userContent).toContain('生産性の向上と孤独感の増大');
		expect(userContent).toContain('推進派');
		expect(userContent).toContain('対面の価値も再認識');
	});

	it('イントロとアウトロで指示文が異なる', async () => {
		const captured: string[] = [];
		generateText.mockImplementation(async (args: unknown) => {
			captured.push((args as { messages: Array<{ content: string }> }).messages[0].content);
			return { text: '文章' };
		});

		const { generateIntro, generateOutro } = await import('../../agents/intro-outro-agent.js');
		await generateIntro(mockInput);
		await generateOutro(mockInput);

		expect(captured[0]).toContain('導入');
		expect(captured[1]).toContain('結び');
		expect(captured[0]).not.toBe(captured[1]);
	});

	it('LLM 出力が空なら AI_API_ERROR を返す', async () => {
		generateText.mockResolvedValueOnce({ text: '' });

		const { generateIntro } = await import('../../agents/intro-outro-agent.js');
		const result = await generateIntro(mockInput);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('AI_API_ERROR');
		}
	});

	it('LLM 呼び出しが失敗した場合は AI_API_ERROR を返す', async () => {
		generateText.mockRejectedValueOnce(new Error('api down'));

		const { generateOutro } = await import('../../agents/intro-outro-agent.js');
		const result = await generateOutro(mockInput);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('AI_API_ERROR');
		}
	});
});
