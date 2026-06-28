import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DebateTurn } from '../../types/turn.types.js';
import type { Chapter } from '../../types/chapter.types.js';
import type { Persona } from '../../types/persona.types.js';

vi.mock('ai', () => ({
	generateObject: vi.fn()
}));

vi.mock('@ai-sdk/anthropic', () => ({
	anthropic: vi.fn(() => 'mock-model')
}));

vi.mock('../../constants/ai.constants.js', () => ({
	AI_MODELS: { SONNET: 'sonnet' },
	MAX_TOKENS: {
		FACILITATOR_OPENING: 512,
		FACILITATOR_CHAPTER_TRANSITION: 512,
		FACILITATOR_INTERVENTION: 512,
		FACILITATOR_COVERAGE: 512
	}
}));

vi.mock('../../utils/prompt-formatters.js', () => ({
	formatTurns: vi.fn(() => '【ターン履歴】'),
	formatPersonas: vi.fn(() => '- p1: テスト'),
	currentDateString: vi.fn(() => '2026-06-19')
}));

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
	interviewRecord: ''
};

const makeChapter = (overrides: Partial<Chapter> = {}): Chapter => ({
	id: 'ch1',
	title: 'テスト章',
	focusQuestion: 'テスト問い？',
	discussionPoints: [],
	...overrides
});

const makeTurn = (content: string, speakerType = 'persona'): DebateTurn => ({
	id: 't1',
	speakerType,
	content,
	createdAt: '2026-06-19T00:00:00Z'
});

const makeObjectResult = (obj: Record<string, unknown>) => ({ object: obj });

describe('generateOpening - 論点対応', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
	});

	it('discussionPoints がある章で、論点1がプロンプトに含まれる', async () => {
		const capturedArgs: unknown[] = [];
		generateObject.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return makeObjectResult({ targetPersonaId: 'p1', content: '論点を問いかける発言' });
		});

		const { generateOpening } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({ discussionPoints: ['自由とは何か', '公平とは何か'] });
		await generateOpening('テーマ', [mockPersona], chapter);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		expect(callArgs.messages[0].content).toContain('自由とは何か');
	});

	it('discussionPoints がある章で selectedDiscussionPointIndex: 0 を返す', async () => {
		generateObject.mockResolvedValueOnce(
			makeObjectResult({ targetPersonaId: 'p1', content: '問いかけ' })
		);

		const { generateOpening } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({ discussionPoints: ['論点1'] });
		const result = await generateOpening('テーマ', [mockPersona], chapter);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.selectedDiscussionPointIndex).toBe(0);
		}
	});

	it('discussionPoints が空の章では selectedDiscussionPointIndex を返さない', async () => {
		generateObject.mockResolvedValueOnce(
			makeObjectResult({ targetPersonaId: 'p1', content: '通常の開幕' })
		);

		const { generateOpening } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({ discussionPoints: [] });
		const result = await generateOpening('テーマ', [mockPersona], chapter);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.selectedDiscussionPointIndex).toBeUndefined();
		}
	});
});

describe('generateChapterIntroduction - 論点対応', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
	});

	it('discussionPoints がある章で、論点1がプロンプトに含まれる', async () => {
		const capturedArgs: unknown[] = [];
		generateObject.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return makeObjectResult({ targetPersonaId: 'p1', content: '章導入' });
		});

		const { generateChapterIntroduction } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({ discussionPoints: ['責任の所在'] });
		await generateChapterIntroduction(chapter, [mockPersona]);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		expect(callArgs.messages[0].content).toContain('責任の所在');
	});

	it('discussionPoints がある場合 selectedDiscussionPointIndex: 0 を返す', async () => {
		generateObject.mockResolvedValueOnce(
			makeObjectResult({ targetPersonaId: 'p1', content: '章導入' })
		);

		const { generateChapterIntroduction } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({ discussionPoints: ['論点X'] });
		const result = await generateChapterIntroduction(chapter, [mockPersona]);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.selectedDiscussionPointIndex).toBe(0);
		}
	});
});

describe('evaluateTopicDrift - 未完了論点対応', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
	});

	it('unaddressedDiscussionPoints がある場合、論点リストがプロンプトに含まれる', async () => {
		const capturedArgs: unknown[] = [];
		generateObject.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return makeObjectResult({ targetPersonaId: 'p1', content: '介入' });
		});

		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		await evaluateTopicDrift([makeTurn('発言')], [mockPersona], new Map(), makeChapter(), [
			'未消化論点A',
			'未消化論点B'
		]);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		expect(callArgs.messages[0].content).toContain('未消化論点A');
	});

	it('unaddressedDiscussionPoints がある場合、三択判断の指示がプロンプトに含まれる', async () => {
		const capturedArgs: unknown[] = [];
		generateObject.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return makeObjectResult({});
		});

		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		await evaluateTopicDrift([makeTurn('発言')], [mockPersona], new Map(), makeChapter(), [
			'論点1'
		]);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		const content = callArgs.messages[0].content;
		expect(content).toMatch(/逸脱|引き戻し|一段落|論点投入|深まり|介入しない/);
	});

	it('selectedDiscussionPointIndex をそのまま返す', async () => {
		generateObject.mockResolvedValueOnce(
			makeObjectResult({
				targetPersonaId: 'p1',
				content: '論点投入',
				selectedDiscussionPointIndex: 1
			})
		);

		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const result = await evaluateTopicDrift(
			[makeTurn('発言')],
			[mockPersona],
			new Map(),
			makeChapter(),
			['論点1', '論点2']
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.selectedDiscussionPointIndex).toBe(1);
		}
	});

	it('unaddressedDiscussionPoints が空の場合、論点リストをプロンプトに含めない', async () => {
		const capturedArgs: unknown[] = [];
		generateObject.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return makeObjectResult({});
		});

		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		await evaluateTopicDrift([makeTurn('発言')], [mockPersona], new Map(), makeChapter(), []);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		expect(callArgs.messages[0].content).not.toContain('未完了論点');
	});
});

describe('evaluateTopicDrift - 出尽くし判断軸と chainLength シグナル', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
	});

	const captureContent = async (fn: () => Promise<unknown>): Promise<string> => {
		const capturedArgs: unknown[] = [];
		generateObject.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return makeObjectResult({});
		});
		await fn();
		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		return callArgs.messages[0].content;
	};

	it('未完了論点ありの場合、出尽くし（発展性なし）の判断軸がプロンプトに含まれる', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift([makeTurn('発言')], [mockPersona], new Map(), makeChapter(), ['論点1'])
		);
		expect(content).toContain('発展性');
	});

	it('未完了論点なしの場合でも、出尽くし（発展性なし）の判断軸がプロンプトに含まれる', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift([makeTurn('発言')], [mockPersona], new Map(), makeChapter(), [])
		);
		expect(content).toContain('発展性');
	});

	it('chainLength を渡すと、その回数と出尽くしを疑う旨がプロンプトに含まれる', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift([makeTurn('発言')], [mockPersona], new Map(), makeChapter(), ['論点1'], {
				chainLength: 5
			})
		);
		expect(content).toContain('5');
		expect(content).toMatch(/連続|続いて/);
	});

	it('options 省略時は chainLength シグナルの文言を含めない（後方互換）', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift([makeTurn('発言')], [mockPersona], new Map(), makeChapter(), ['論点1'])
		);
		expect(content).not.toMatch(/補足シグナル|回連続/);
	});

	it('chainLength=0 はシグナルとして扱わず文言を含めない', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift([makeTurn('発言')], [mockPersona], new Map(), makeChapter(), ['論点1'], {
				chainLength: 0
			})
		);
		expect(content).not.toMatch(/補足シグナル|回連続/);
	});

	it('論点がひととおり出尽くしたら次論点へ前進させる中庸な判断軸が含まれる', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift([makeTurn('発言')], [mockPersona], new Map(), makeChapter(), ['論点1'])
		);
		expect(content).toMatch(/ひととおり|前進/);
	});

	it('まだ新しい視点が出ている間は見送る旨が含まれる', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift([makeTurn('発言')], [mockPersona], new Map(), makeChapter(), ['論点1'])
		);
		expect(content).toMatch(/新しい(視点|内容).*(見送|深ま|介入しない)/);
	});
});

describe('evaluateStallIntervention - 未完了論点対応', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
	});

	it('unaddressedDiscussionPoints がある場合、流れ優先の指示が含まれる', async () => {
		const capturedArgs: unknown[] = [];
		generateObject.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return makeObjectResult({});
		});

		const { evaluateStallIntervention } = await import('../../agents/facilitator-agent.js');
		await evaluateStallIntervention([makeTurn('発言')], [mockPersona], new Map(), makeChapter(), [
			'未消化論点'
		]);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		const content = callArgs.messages[0].content;
		expect(content).toContain('未消化論点');
		expect(content).toMatch(/流れ|落ち着い/);
	});

	it('selectedDiscussionPointIndex をそのまま返す', async () => {
		generateObject.mockResolvedValueOnce(
			makeObjectResult({
				targetPersonaId: 'p1',
				content: '論点投入',
				selectedDiscussionPointIndex: 0
			})
		);

		const { evaluateStallIntervention } = await import('../../agents/facilitator-agent.js');
		const result = await evaluateStallIntervention(
			[makeTurn('発言')],
			[mockPersona],
			new Map(),
			makeChapter(),
			['論点1']
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.selectedDiscussionPointIndex).toBe(0);
		}
	});
});

describe('evaluateDiscussionPointCoverage', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
	});

	it('消化済みと判定された論点のインデックス配列を返す', async () => {
		generateObject.mockResolvedValueOnce(makeObjectResult({ addressedIndices: [0, 2] }));

		const { evaluateDiscussionPointCoverage } = await import('../../agents/facilitator-agent.js');
		const turns = [makeTurn('論点Aについて話した'), makeTurn('論点Cについても話した')];
		const result = await evaluateDiscussionPointCoverage(turns, ['論点A', '論点B', '論点C']);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual([0, 2]);
		}
	});

	it('全論点未消化の場合は空配列を返す', async () => {
		generateObject.mockResolvedValueOnce(makeObjectResult({ addressedIndices: [] }));

		const { evaluateDiscussionPointCoverage } = await import('../../agents/facilitator-agent.js');
		const result = await evaluateDiscussionPointCoverage([makeTurn('無関係な発言')], ['論点A']);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual([]);
		}
	});

	it('AI 呼び出し失敗時は ok: false でエラーを返す', async () => {
		generateObject.mockRejectedValueOnce(new Error('API error'));

		const { evaluateDiscussionPointCoverage } = await import('../../agents/facilitator-agent.js');
		const result = await evaluateDiscussionPointCoverage([makeTurn('発言')], ['論点A']);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('AI_API_ERROR');
		}
	});

	it('ターンと未完了論点の内容がプロンプトに含まれる', async () => {
		const capturedArgs: unknown[] = [];
		generateObject.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return makeObjectResult({ addressedIndices: [] });
		});

		const { evaluateDiscussionPointCoverage } = await import('../../agents/facilitator-agent.js');
		await evaluateDiscussionPointCoverage(
			[makeTurn('テスト発言A')],
			['チェックする論点X'],
			[mockPersona]
		);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		expect(callArgs.messages[0].content).toContain('チェックする論点X');
	});
});

describe('generateClosing - personas 引き渡し', () => {
	beforeEach(async () => {
		vi.resetModules();
	});

	it('formatTurns に personas を渡す', async () => {
		const formatMod = await import('../../utils/prompt-formatters.js');
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce(
			makeObjectResult({ content: 'クロージング' })
		);

		const { generateClosing } = await import('../../agents/facilitator-agent.js');
		const personas = [mockPersona];
		await generateClosing([makeTurn('test')], new Map(), personas);

		expect(vi.mocked(formatMod.formatTurns)).toHaveBeenCalledWith(expect.any(Array), personas);
	});
});
