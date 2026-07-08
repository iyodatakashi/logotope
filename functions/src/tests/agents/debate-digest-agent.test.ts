import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DebateTurn } from '../../types/turn.types.js';
import type { Persona } from '../../types/persona.types.js';

vi.mock('ai', () => ({
	generateText: vi.fn()
}));

vi.mock('@ai-sdk/anthropic', () => ({
	anthropic: vi.fn(() => 'mock-model')
}));

vi.mock('../../constants/ai.constants.js', () => ({
	AI_MODELS: { SONNET: 'sonnet' }
}));

const mockPersona: Persona = {
	id: 'p1',
	topicId: 'topic1',
	name: 'テスト太郎',
	age: 30,
	occupation: '会社員',
	stakeholderRole: '一般',
	specificRole: 'エンジニア',
	background: '',
	interests: '',
	nationality: '日本',
	engagementLevel: 'moderate',
	llmType: 'claude',
	approved: true,
	sortOrder: 0,
	interviewRecord: ''
};

const makeTurn = (id: string, content: string, personaId: string | null = 'p1'): DebateTurn => ({
	id,
	speakerType: personaId ? 'persona' : 'facilitator',
	personaId,
	content,
	createdAt: '2026-07-05T00:00:00Z' as unknown as DebateTurn['createdAt']
});

describe('summarizeChapter', () => {
	let generateText: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		const aiMod = await import('ai');
		generateText = vi.mocked(aiMod.generateText);
	});

	it('会話を圧縮した非空の散文を返す', async () => {
		generateText.mockResolvedValueOnce({
			text: '第1章では、論点Aについて賛否両方の立場が示された。'
		});

		const { summarizeChapter } = await import('../../agents/debate-digest-agent.js');
		const result = await summarizeChapter({
			title: '第1章',
			agenda: ['論点A'],
			turns: [makeTurn('t1', '私は賛成だ'), makeTurn('t2', '私は反対だ', 'p2')],
			personas: [mockPersona]
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.length).toBeGreaterThan(0);
			expect(result.value).toBe('第1章では、論点Aについて賛否両方の立場が示された。');
		}
	});

	it('システムプロンプトに非結論・非支持の制約が含まれる', async () => {
		const capturedArgs: unknown[] = [];
		generateText.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return { text: '中立の要約' };
		});

		const { summarizeChapter } = await import('../../agents/debate-digest-agent.js');
		await summarizeChapter({
			title: '第1章',
			agenda: [],
			turns: [makeTurn('t1', '発言')],
			personas: [mockPersona]
		});

		const callArgs = capturedArgs[0] as { system: string; messages: Array<{ content: string }> };
		expect(callArgs.system).toMatch(/結論|優劣/);
		expect(callArgs.system).toMatch(/支持|否定/);
		expect(callArgs.messages[0].content).toContain('第1章');
	});

	it('LLM 出力が空なら AI_API_ERROR を返す', async () => {
		generateText.mockResolvedValueOnce({ text: '   ' });

		const { summarizeChapter } = await import('../../agents/debate-digest-agent.js');
		const result = await summarizeChapter({
			title: '第1章',
			agenda: [],
			turns: [makeTurn('t1', '発言')],
			personas: [mockPersona]
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('AI_API_ERROR');
		}
	});

	it('LLM 呼び出しが失敗した場合は AI_API_ERROR を返す', async () => {
		generateText.mockRejectedValueOnce(new Error('api down'));

		const { summarizeChapter } = await import('../../agents/debate-digest-agent.js');
		const result = await summarizeChapter({
			title: '第1章',
			agenda: [],
			turns: [makeTurn('t1', '発言')],
			personas: [mockPersona]
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('AI_API_ERROR');
		}
	});
});
