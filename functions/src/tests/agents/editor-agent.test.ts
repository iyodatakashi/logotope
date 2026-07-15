import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DebateTurn } from '../../types/turn.types.js';
import type { Persona } from '../../types/persona.types.js';

vi.mock('ai', () => ({
	generateObject: vi.fn(),
	generateText: vi.fn()
}));

vi.mock('../../llm/models.js', () => ({
	sonnet: 'mock-model'
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
	selected: true,
	sortOrder: 0,
	interviewRecord: ''
};

const makeTurn = (id: string, content: string, personaId: string | null = 'p1'): DebateTurn => ({
	id,
	speakerType: personaId ? 'persona' : 'facilitator',
	personaId,
	content,
	createdAt: '2026-06-19T00:00:00Z' as unknown as DebateTurn['createdAt']
});

const makeObjectResult = (obj: Record<string, unknown>) => ({ object: obj });

describe('editChapter', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
	});

	it('LLM 出力から由来ID付きの編集後ターン列を返す', async () => {
		generateObject.mockResolvedValueOnce(
			makeObjectResult({
				turns: [
					{
						sourceTurnIds: ['t1', 't2'],
						speakerType: 'persona',
						personaId: 'p1',
						content: '連結された編集後の散文',
						speechMode: 'opinion'
					}
				]
			})
		);

		const { editChapter } = await import('../../agents/editor-agent.js');
		const result = await editChapter(
			{
				title: '第1章',
				agenda: ['論点A'],
				turns: [makeTurn('t1', '冗長な発言その1'), makeTurn('t2', '冗長な発言その2')]
			},
			[mockPersona],
			new Set<string>()
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual([
				{
					sourceTurnIds: ['t1', 't2'],
					speakerType: 'persona',
					personaId: 'p1',
					content: '連結された編集後の散文',
					speechMode: 'opinion'
				}
			]);
		}
	});

	it('原本ターンIDと保護対象IDをプロンプトに含める', async () => {
		const capturedArgs: unknown[] = [];
		generateObject.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return makeObjectResult({
				turns: [
					{ sourceTurnIds: ['t1'], speakerType: 'persona', personaId: 'p1', content: '編集後' }
				]
			});
		});

		const { editChapter } = await import('../../agents/editor-agent.js');
		await editChapter(
			{
				title: '第1章',
				agenda: ['論点A'],
				turns: [makeTurn('t1', '発言1'), makeTurn('t2', '発言2')]
			},
			[mockPersona],
			new Set(['t1'])
		);

		const callArgs = capturedArgs[0] as {
			system: string;
			messages: Array<{ content: string }>;
		};
		const userContent = callArgs.messages[0].content;
		expect(userContent).toContain('t1');
		expect(userContent).toContain('t2');
		// 保護対象IDが除外禁止として提示される
		expect(userContent).toContain('t1');
		// システムプロンプトに不変条件（意味・立場・帰属の保持）が含まれる
		expect(callArgs.system).toMatch(/立場|意味|帰属/);
	});

	it('speechMode が未指定の場合は undefined を返す', async () => {
		generateObject.mockResolvedValueOnce(
			makeObjectResult({
				turns: [
					{ sourceTurnIds: ['t1'], speakerType: 'persona', personaId: 'p1', content: '編集後' }
				]
			})
		);

		const { editChapter } = await import('../../agents/editor-agent.js');
		const result = await editChapter(
			{ title: '第1章', agenda: [], turns: [makeTurn('t1', '発言1')] },
			[mockPersona],
			new Set<string>()
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value[0].speechMode).toBeUndefined();
		}
	});

	it('LLM 呼び出しが失敗した場合は AI_API_ERROR を返す', async () => {
		generateObject.mockRejectedValueOnce(new Error('api down'));

		const { editChapter } = await import('../../agents/editor-agent.js');
		const result = await editChapter(
			{ title: '第1章', agenda: [], turns: [makeTurn('t1', '発言1')] },
			[mockPersona],
			new Set<string>()
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('AI_API_ERROR');
		}
	});
});

describe('editImpression', () => {
	let generateText: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateText = vi.mocked(aiMod.generateText);
	});

	it('所感の原本を整えた編集後テキストを返す（配列でなく単一テキスト・ドロップしない）', async () => {
		generateText.mockResolvedValueOnce({ text: '整えた所感' } as never);
		const { editImpression } = await import('../../agents/editor-agent.js');
		const result = await editImpression('冗長な所感の原本');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toBe('整えた所感');
	});

	it('空文字が返った場合は AI_API_ERROR を返す', async () => {
		generateText.mockResolvedValueOnce({ text: '   ' } as never);
		const { editImpression } = await import('../../agents/editor-agent.js');
		const result = await editImpression('原本');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe('AI_API_ERROR');
	});

	it('LLM 呼び出しが失敗した場合は AI_API_ERROR を返す', async () => {
		generateText.mockRejectedValueOnce(new Error('api down'));
		const { editImpression } = await import('../../agents/editor-agent.js');
		const result = await editImpression('原本');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe('AI_API_ERROR');
	});
});

describe('editIntro / editOutro', () => {
	let generateText: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateText = vi.mocked(aiMod.generateText);
	});

	it('導入の原本を整えた編集後テキストを返す', async () => {
		generateText.mockResolvedValueOnce({ text: '整えた導入' } as never);
		const { editIntro } = await import('../../agents/editor-agent.js');
		const result = await editIntro('冗長な導入の原本');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toBe('整えた導入');
	});

	it('締めの原本を整えた編集後テキストを返す', async () => {
		generateText.mockResolvedValueOnce({ text: '整えた締め' } as never);
		const { editOutro } = await import('../../agents/editor-agent.js');
		const result = await editOutro('冗長な締めの原本');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toBe('整えた締め');
	});

	it('空文字が返った場合は AI_API_ERROR を返す', async () => {
		generateText.mockResolvedValueOnce({ text: '   ' } as never);
		const { editIntro } = await import('../../agents/editor-agent.js');
		const result = await editIntro('原本');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe('AI_API_ERROR');
	});

	it('LLM 呼び出しが失敗した場合は AI_API_ERROR を返す', async () => {
		generateText.mockRejectedValueOnce(new Error('api down'));
		const { editOutro } = await import('../../agents/editor-agent.js');
		const result = await editOutro('原本');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe('AI_API_ERROR');
	});
});
