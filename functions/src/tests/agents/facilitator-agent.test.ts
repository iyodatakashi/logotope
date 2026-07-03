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
	currentDateString: vi.fn(() => '2026-06-19'),
	// 事実節整形の実体は prompt-formatters.test.ts で検証。ここでは呼び出し配線のみ検証する。
	formatFactBaseSection: vi.fn((factBase?: { facts: { statement: string }[] }) =>
		factBase?.facts?.length
			? `\n\n【確定した客観的事実（共通前提）】\n${factBase.facts.map((f) => f.statement).join('\n')}`
			: ''
	)
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

	it('factBase を背景の共通前提として注入し、問いかけは平易に保つ注記を添える（R8.1）', async () => {
		const capturedArgs: unknown[] = [];
		generateObject.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return makeObjectResult({ targetPersonaId: 'p1', content: '開幕' });
		});

		const { generateOpening } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({ discussionPoints: ['論点1'] });
		await generateOpening('テーマ', [mockPersona], chapter, {
			facts: [{ statement: '日本は1回戦で敗退した', sources: [] }],
			generatedAt: new Date('2026-07-03T00:00:00Z')
		});

		const content = (capturedArgs[0] as { messages: Array<{ content: string }> }).messages[0]
			.content;
		expect(content).toContain('【確定した客観的事実（共通前提）】');
		expect(content).toContain('日本は1回戦で敗退した');
		expect(content).toContain('背景として把握');
	});

	it('factBase 未指定なら事実節を注入しない（従来どおり）', async () => {
		const capturedArgs: unknown[] = [];
		generateObject.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return makeObjectResult({ targetPersonaId: 'p1', content: '開幕' });
		});

		const { generateOpening } = await import('../../agents/facilitator-agent.js');
		await generateOpening('テーマ', [mockPersona], makeChapter({ discussionPoints: ['論点1'] }));

		const content = (capturedArgs[0] as { messages: Array<{ content: string }> }).messages[0]
			.content;
		expect(content).not.toContain('【確定した客観的事実（共通前提）】');
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
		await evaluateTopicDrift(
			[makeTurn('発言')],
			[mockPersona],
			new Map(),
			makeChapter(),
			'アクティブ論点',
			['未消化論点A', '未消化論点B']
		);

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
		await evaluateTopicDrift(
			[makeTurn('発言')],
			[mockPersona],
			new Map(),
			makeChapter(),
			'アクティブ論点',
			['論点1']
		);

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
			'アクティブ論点',
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
		await evaluateTopicDrift(
			[makeTurn('発言')],
			[mockPersona],
			new Map(),
			makeChapter(),
			'アクティブ論点',
			[]
		);

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
			evaluateTopicDrift(
				[makeTurn('発言')],
				[mockPersona],
				new Map(),
				makeChapter(),
				'アクティブ論点',
				['論点1']
			)
		);
		expect(content).toContain('発展性');
	});

	it('未完了論点なしの場合でも、出尽くし（発展性なし）の判断軸がプロンプトに含まれる', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift(
				[makeTurn('発言')],
				[mockPersona],
				new Map(),
				makeChapter(),
				'アクティブ論点',
				[]
			)
		);
		expect(content).toContain('発展性');
	});

	it('chainLength を渡すと、その回数と出尽くしを疑う旨がプロンプトに含まれる', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift(
				[makeTurn('発言')],
				[mockPersona],
				new Map(),
				makeChapter(),
				'アクティブ論点',
				['論点1'],
				{
					chainLength: 5
				}
			)
		);
		expect(content).toContain('5');
		expect(content).toMatch(/連続|続いて/);
	});

	it('options 省略時は chainLength シグナルの文言を含めない（後方互換）', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift(
				[makeTurn('発言')],
				[mockPersona],
				new Map(),
				makeChapter(),
				'アクティブ論点',
				['論点1']
			)
		);
		expect(content).not.toMatch(/補足シグナル|回連続/);
	});

	it('chainLength=0 はシグナルとして扱わず文言を含めない', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift(
				[makeTurn('発言')],
				[mockPersona],
				new Map(),
				makeChapter(),
				'アクティブ論点',
				['論点1'],
				{
					chainLength: 0
				}
			)
		);
		expect(content).not.toMatch(/補足シグナル|回連続/);
	});

	it('論点がひととおり出尽くしたら次論点へ前進させる中庸な判断軸が含まれる', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift(
				[makeTurn('発言')],
				[mockPersona],
				new Map(),
				makeChapter(),
				'アクティブ論点',
				['論点1']
			)
		);
		expect(content).toMatch(/ひととおり|前進/);
	});

	it('まだ新しい視点が出ている間は見送る旨が含まれる', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift(
				[makeTurn('発言')],
				[mockPersona],
				new Map(),
				makeChapter(),
				'アクティブ論点',
				['論点1']
			)
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
		await evaluateStallIntervention(
			[makeTurn('発言')],
			[mockPersona],
			new Map(),
			makeChapter(),
			'アクティブ論点',
			['未消化論点']
		);

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
			'アクティブ論点',
			['論点1']
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.selectedDiscussionPointIndex).toBe(0);
		}
	});
});

describe('介入評価の判断軸 - アクティブ論点（2.1）', () => {
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

	it('evaluateTopicDrift: プロンプトにアクティブ論点が含まれ、focusQuestion 文言を含まない', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({});
		const content = await captureContent(() =>
			evaluateTopicDrift(
				[makeTurn('発言')],
				[mockPersona],
				new Map(),
				chapter,
				'いま向き合う論点',
				['論点1']
			)
		);
		expect(content).toContain('いま向き合う論点');
		expect(content).not.toContain('フォーカス問いの文言');
		expect(content).not.toContain('フォーカス問い');
	});

	it('evaluateTopicDrift: アクティブ論点が undefined なら章タイトルを判断軸にする', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({ title: '章タイトルZ' });
		const content = await captureContent(() =>
			evaluateTopicDrift([makeTurn('発言')], [mockPersona], new Map(), chapter, undefined, [
				'論点1'
			])
		);
		expect(content).toContain('章タイトルZ');
		expect(content).not.toContain('フォーカス問い');
	});

	it('evaluateStallIntervention: プロンプトにアクティブ論点が含まれ、focusQuestion 文言を含まない', async () => {
		const { evaluateStallIntervention } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({});
		const content = await captureContent(() =>
			evaluateStallIntervention(
				[makeTurn('発言')],
				[mockPersona],
				new Map(),
				chapter,
				'出尽くし論点',
				['論点1']
			)
		);
		expect(content).toContain('出尽くし論点');
		expect(content).not.toContain('フォーカス問い');
	});
});

describe('章導入の入口一本化 - 二重提示の解消（2.2）', () => {
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
			return makeObjectResult({ targetPersonaId: 'p1', content: '導入' });
		});
		await fn();
		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		return callArgs.messages[0].content;
	};

	it('generateOpening: 先頭論点を入口にし focusQuestion を二重提示しない', async () => {
		const { generateOpening } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({
			discussionPoints: ['先頭論点XYZ', '論点2']
		});
		const content = await captureContent(() => generateOpening('テーマ', [mockPersona], chapter));
		expect(content).toContain('先頭論点XYZ');
		expect(content).not.toContain('フォーカス問いの文言');
		expect(content).not.toContain('フォーカス');
	});

	it('generateOpening: 論点を持たない章は章タイトルを入口にする', async () => {
		const { generateOpening } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({ title: '入口タイトル', discussionPoints: [] });
		const content = await captureContent(() => generateOpening('テーマ', [mockPersona], chapter));
		expect(content).toContain('入口タイトル');
	});

	it('generateChapterIntroduction: 先頭論点を入口にし focusQuestion を二重提示しない', async () => {
		const { generateChapterIntroduction } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({
			discussionPoints: ['先頭論点XYZ', '論点2']
		});
		const content = await captureContent(() => generateChapterIntroduction(chapter, [mockPersona]));
		expect(content).toContain('先頭論点XYZ');
		expect(content).not.toContain('フォーカス問いの文言');
		expect(content).not.toContain('フォーカス');
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

describe('論点投入時の関連参加者返却（3.1）', () => {
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
			return makeObjectResult({ targetPersonaId: 'p1', content: '発言' });
		});
		await fn();
		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		return callArgs.messages[0].content;
	};

	it('generateOpening: 返却に relevantPersonaIds を含める', async () => {
		generateObject.mockResolvedValueOnce(
			makeObjectResult({
				targetPersonaId: 'p1',
				content: '問いかけ',
				relevantPersonaIds: ['p1', 'p2']
			})
		);
		const { generateOpening } = await import('../../agents/facilitator-agent.js');
		const result = await generateOpening(
			'テーマ',
			[mockPersona],
			makeChapter({ discussionPoints: ['論点1'] })
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.relevantPersonaIds).toEqual(['p1', 'p2']);
		}
	});

	it('generateOpening: 関連参加者を全員一律に含めない旨の指示がプロンプトに含まれる', async () => {
		const content = await captureContent(() =>
			import('../../agents/facilitator-agent.js').then(({ generateOpening }) =>
				generateOpening('テーマ', [mockPersona], makeChapter({ discussionPoints: ['論点1'] }))
			)
		);
		expect(content).toContain('relevantPersonaIds');
		expect(content).toMatch(/立場を聞くべき|一律に含めない|絞っ/);
	});

	it('evaluateTopicDrift: 返却に relevantPersonaIds を含める', async () => {
		generateObject.mockResolvedValueOnce(
			makeObjectResult({
				targetPersonaId: 'p1',
				content: '論点投入',
				selectedDiscussionPointIndex: 0,
				relevantPersonaIds: ['p2', 'p3']
			})
		);
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const result = await evaluateTopicDrift(
			[makeTurn('発言')],
			[mockPersona],
			new Map(),
			makeChapter(),
			'アクティブ論点',
			['論点1']
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.relevantPersonaIds).toEqual(['p2', 'p3']);
		}
	});

	it('evaluateTopicDrift: 論点投入時の関連参加者指定の指示がプロンプトに含まれる', async () => {
		const content = await captureContent(() =>
			import('../../agents/facilitator-agent.js').then(({ evaluateTopicDrift }) =>
				evaluateTopicDrift(
					[makeTurn('発言')],
					[mockPersona],
					new Map(),
					makeChapter(),
					'アクティブ論点',
					['論点1']
				)
			)
		);
		expect(content).toContain('relevantPersonaIds');
		expect(content).toMatch(/立場を聞くべき|一律に含めない|絞っ/);
	});
});

describe('出尽くし二軸化と未発言者の引き込み（3.2）', () => {
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

	it('evaluateTopicDrift: 未発言の関連参加者を渡すと、その名前と引き込み指示が含まれる', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift(
				[makeTurn('発言')],
				[mockPersona],
				new Map(),
				makeChapter(),
				'アクティブ論点',
				[],
				{
					unheardRelevant: ['田中', '佐藤']
				}
			)
		);
		expect(content).toContain('田中');
		expect(content).toContain('佐藤');
		expect(content).toMatch(/立場/);
		expect(content).toMatch(/いまの論点を維持|新しい論点を投入せず|新論点/);
	});

	it('evaluateTopicDrift: 未発言者が残る間は新規性のなさだけで前進させない旨が含まれる', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift(
				[makeTurn('発言')],
				[mockPersona],
				new Map(),
				makeChapter(),
				'アクティブ論点',
				[],
				{
					unheardRelevant: ['田中']
				}
			)
		);
		expect(content).toMatch(/出尽くし|新規性|発展性/);
		expect(content).toMatch(/前進させ|進めない/);
	});

	it('evaluateTopicDrift: 未発言者が空なら引き込みセクションを含めない', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift(
				[makeTurn('発言')],
				[mockPersona],
				new Map(),
				makeChapter(),
				'アクティブ論点',
				['論点1'],
				{
					unheardRelevant: []
				}
			)
		);
		expect(content).not.toContain('立場カバレッジ');
	});

	it('evaluateStallIntervention: 未発言の関連参加者を渡すと引き込み指示が含まれる', async () => {
		const { evaluateStallIntervention } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateStallIntervention(
				[makeTurn('発言')],
				[mockPersona],
				new Map(),
				makeChapter(),
				'アクティブ論点',
				[],
				{
					unheardRelevant: ['山田']
				}
			)
		);
		expect(content).toContain('山田');
		expect(content).toMatch(/立場/);
	});
});

describe('chainLength シグナルの解釈是正（3.3）', () => {
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

	it('未発言者が残るとき、チェーン長は引き込み優先のシグナルとして提示される', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift(
				[makeTurn('発言')],
				[mockPersona],
				new Map(),
				makeChapter(),
				'アクティブ論点',
				[],
				{
					chainLength: 5,
					unheardRelevant: ['田中']
				}
			)
		);
		expect(content).toContain('5');
		expect(content).toMatch(/引き込み|未発言/);
		expect(content).not.toMatch(/出尽くしのサイン|出尽くし判断の参考/);
	});

	it('未発言者が残らないとき、チェーン長は従来どおり出尽くし判断の参考として提示される', async () => {
		const { evaluateTopicDrift } = await import('../../agents/facilitator-agent.js');
		const content = await captureContent(() =>
			evaluateTopicDrift(
				[makeTurn('発言')],
				[mockPersona],
				new Map(),
				makeChapter(),
				'アクティブ論点',
				['論点1'],
				{
					chainLength: 5,
					unheardRelevant: []
				}
			)
		);
		expect(content).toContain('5');
		expect(content).toMatch(/出尽くし/);
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
