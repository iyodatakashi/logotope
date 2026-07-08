import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DebateTurn } from '../../types/turn.types.js';
import type { Chapter } from '../../types/chapter.types.js';
import type { Persona } from '../../types/persona.types.js';

vi.mock('ai', () => ({
	generateObject: vi.fn()
}));

vi.mock('../../llm/models.js', () => ({
	sonnet: 'mock-model'
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
	approved: true,
	sortOrder: 0,
	interviewRecord: ''
};

const makeChapter = (overrides: Partial<Chapter> = {}): Chapter => ({
	id: 'ch1',
	title: 'テスト章',
	agenda: [],
	...overrides
});

const makeTurn = (content: string, speakerType = 'persona'): DebateTurn => ({
	id: 't1',
	speakerType,
	content,
	createdAt: '2026-06-19T00:00:00Z'
});

const makeObjectResult = (obj: Record<string, unknown>) => ({ object: obj });

describe('assessActiveAgendaItem - 出尽くし判定（判定のみ・行動なし）', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
	});

	const captureCall = async (
		fn: () => Promise<unknown>
	): Promise<{ content: string; schema: unknown }> => {
		const capturedArgs: unknown[] = [];
		generateObject.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return makeObjectResult({ verdict: 'ongoing' });
		});
		await fn();
		const callArgs = capturedArgs[0] as {
			messages: Array<{ content: string }>;
			schema: unknown;
		};
		return { content: callArgs.messages[0].content, schema: callArgs.schema };
	};

	it('exhausted / drifted / ongoing の verdict をそのまま返す', async () => {
		const { assessActiveAgendaItem } = await import('../../agents/facilitator-agent.js');

		for (const verdict of ['exhausted', 'drifted', 'ongoing'] as const) {
			generateObject.mockResolvedValueOnce(makeObjectResult({ verdict }));
			const result = await assessActiveAgendaItem('アクティブ論点', [makeTurn('発言')], [mockPersona]);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual({ verdict });
			}
		}
	});

	it('返り値は verdict のみ（content・項目選択・指名を一切含まない）', async () => {
		generateObject.mockResolvedValueOnce(makeObjectResult({ verdict: 'exhausted' }));

		const { assessActiveAgendaItem } = await import('../../agents/facilitator-agent.js');
		const result = await assessActiveAgendaItem('アクティブ論点', [makeTurn('発言')], [mockPersona]);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Object.keys(result.value)).toEqual(['verdict']);
			expect(result.value).not.toHaveProperty('content');
			expect(result.value).not.toHaveProperty('targetPersonaId');
			expect(result.value).not.toHaveProperty('selectedAgendaItemIndex');
			expect(result.value).not.toHaveProperty('relevantPersonaIds');
		}
	});

	it('プロンプトにアクティブ論点と3値判定の指示が含まれる', async () => {
		const { assessActiveAgendaItem } = await import('../../agents/facilitator-agent.js');
		const { content } = await captureCall(() =>
			assessActiveAgendaItem('いま向き合う論点X', [makeTurn('発言')], [mockPersona])
		);
		expect(content).toContain('いま向き合う論点X');
		expect(content).toContain('exhausted');
		expect(content).toContain('drifted');
		expect(content).toContain('ongoing');
		expect(content).toMatch(/出尽くし|発展性/);
		expect(content).toMatch(/逸脱|ずれ/);
	});

	it('プロンプトが発言生成・項目投入を指示しない（純粋判定）', async () => {
		const { assessActiveAgendaItem } = await import('../../agents/facilitator-agent.js');
		const { content } = await captureCall(() =>
			assessActiveAgendaItem('アクティブ論点', [makeTurn('発言')], [mockPersona])
		);
		expect(content).toContain('判定だけ');
		expect(content).not.toContain('selectedAgendaItemIndex');
		expect(content).not.toContain('relevantPersonaIds');
		expect(content).not.toContain('未提示論点リスト');
	});

	it('AI 呼び出し失敗時は ok: false でエラーを返す', async () => {
		generateObject.mockRejectedValueOnce(new Error('API error'));

		const { assessActiveAgendaItem } = await import('../../agents/facilitator-agent.js');
		const result = await assessActiveAgendaItem('アクティブ論点', [makeTurn('発言')], [mockPersona]);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('AI_API_ERROR');
		}
	});
});

describe('generateInterventionUtterance - 行動（発言生成）の独立', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
		generateObject.mockClear();
	});

	const captureContent = async (fn: () => Promise<unknown>): Promise<string> => {
		const capturedArgs: unknown[] = [];
		generateObject.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return makeObjectResult({ targetPersonaId: 'p1', content: '発言', selectedAgendaItemIndex: 0 });
		});
		await fn();
		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		return callArgs.messages[0].content;
	};

	describe('introduce（次項目の投入）', () => {
		it('未提示論点リストと index 指示・忠実性（折衷禁止）がプロンプトに含まれる', async () => {
			const { generateInterventionUtterance } = await import('../../agents/facilitator-agent.js');
			const content = await captureContent(() =>
				generateInterventionUtterance(
					{ kind: 'introduce', untouchedAgendaItems: ['論点A', '論点B'] },
					makeChapter(),
					[makeTurn('発言')],
					[mockPersona]
				)
			);
			expect(content).toContain('論点A');
			expect(content).toContain('論点B');
			expect(content).toContain('selectedAgendaItemIndex');
			expect(content).toMatch(/正面から切り込む|主題として/);
			expect(content).toMatch(/折衷|混ぜ/);
		});

		it('返り値に selectedAgendaItemIndex を含める（relevantPersonaIds は付けない）', async () => {
			generateObject.mockResolvedValueOnce(
				makeObjectResult({
					content: '論点投入',
					targetPersonaId: 'p1',
					selectedAgendaItemIndex: 1
				})
			);
			const { generateInterventionUtterance } = await import('../../agents/facilitator-agent.js');
			const result = await generateInterventionUtterance(
				{ kind: 'introduce', untouchedAgendaItems: ['論点A', '論点B'] },
				makeChapter(),
				[makeTurn('発言')],
				[mockPersona]
			);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.selectedAgendaItemIndex).toBe(1);
				expect(result.value).not.toHaveProperty('relevantPersonaIds');
			}
		});

		it('未提示論点が空のときは LLM を呼ばず投入発言を生成しない（ok: false）', async () => {
			const { generateInterventionUtterance } = await import('../../agents/facilitator-agent.js');
			const result = await generateInterventionUtterance(
				{ kind: 'introduce', untouchedAgendaItems: [] },
				makeChapter(),
				[makeTurn('発言')],
				[mockPersona]
			);
			expect(result.ok).toBe(false);
			expect(generateObject).not.toHaveBeenCalled();
			if (!result.ok) {
				expect(result.error.code).toBe('VALIDATION_ERROR');
			}
		});
	});

	describe('pull-back（引き戻し）', () => {
		it('アクティブ項目への引き戻し指示がプロンプトに含まれる', async () => {
			const { generateInterventionUtterance } = await import('../../agents/facilitator-agent.js');
			const content = await captureContent(() =>
				generateInterventionUtterance(
					{ kind: 'pull-back', activeAgendaItem: 'いまの論点Z' },
					makeChapter(),
					[makeTurn('発言')],
					[mockPersona]
				)
			);
			expect(content).toContain('いまの論点Z');
			expect(content).toMatch(/戻し|引き戻/);
		});

		it('返り値は content と targetPersonaId のみ（index・relevant を付けない）', async () => {
			generateObject.mockResolvedValueOnce(
				makeObjectResult({ content: '本題に戻しましょう', targetPersonaId: 'p1' })
			);
			const { generateInterventionUtterance } = await import('../../agents/facilitator-agent.js');
			const result = await generateInterventionUtterance(
				{ kind: 'pull-back', activeAgendaItem: 'いまの論点Z' },
				makeChapter(),
				[makeTurn('発言')],
				[mockPersona]
			);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.content).toBe('本題に戻しましょう');
				expect(result.value.targetPersonaId).toBe('p1');
				expect(result.value.selectedAgendaItemIndex).toBeUndefined();
				expect(result.value.relevantPersonaIds).toBeUndefined();
			}
		});
	});

	it('AI 呼び出し失敗時は ok: false でエラーを返す', async () => {
		generateObject.mockRejectedValueOnce(new Error('API error'));
		const { generateInterventionUtterance } = await import('../../agents/facilitator-agent.js');
		const result = await generateInterventionUtterance(
			{ kind: 'pull-back', activeAgendaItem: '論点' },
			makeChapter(),
			[makeTurn('発言')],
			[mockPersona]
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('AI_API_ERROR');
		}
	});
});

describe('generateOpening - 論点対応', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
	});

	it('agenda がある章で、論点1がプロンプトに含まれる', async () => {
		const capturedArgs: unknown[] = [];
		generateObject.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return makeObjectResult({ targetPersonaId: 'p1', content: '論点を問いかける発言' });
		});

		const { generateOpening } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({ agenda: ['自由とは何か', '公平とは何か'] });
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
		const chapter = makeChapter({ agenda: ['論点1'] });
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
		await generateOpening('テーマ', [mockPersona], makeChapter({ agenda: ['論点1'] }));

		const content = (capturedArgs[0] as { messages: Array<{ content: string }> }).messages[0]
			.content;
		expect(content).not.toContain('【確定した客観的事実（共通前提）】');
	});

	it('agenda がある章で selectedAgendaItemIndex: 0 を返す', async () => {
		generateObject.mockResolvedValueOnce(
			makeObjectResult({ targetPersonaId: 'p1', content: '問いかけ' })
		);

		const { generateOpening } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({ agenda: ['論点1'] });
		const result = await generateOpening('テーマ', [mockPersona], chapter);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.selectedAgendaItemIndex).toBe(0);
		}
	});

	it('agenda が空の章では selectedAgendaItemIndex を返さない', async () => {
		generateObject.mockResolvedValueOnce(
			makeObjectResult({ targetPersonaId: 'p1', content: '通常の開幕' })
		);

		const { generateOpening } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({ agenda: [] });
		const result = await generateOpening('テーマ', [mockPersona], chapter);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.selectedAgendaItemIndex).toBeUndefined();
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

	it('agenda がある章で、論点1がプロンプトに含まれる', async () => {
		const capturedArgs: unknown[] = [];
		generateObject.mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return makeObjectResult({ targetPersonaId: 'p1', content: '章導入' });
		});

		const { generateChapterIntroduction } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({ agenda: ['責任の所在'] });
		await generateChapterIntroduction(chapter, [mockPersona]);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		expect(callArgs.messages[0].content).toContain('責任の所在');
	});

	it('agenda がある場合 selectedAgendaItemIndex: 0 を返す', async () => {
		generateObject.mockResolvedValueOnce(
			makeObjectResult({ targetPersonaId: 'p1', content: '章導入' })
		);

		const { generateChapterIntroduction } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({ agenda: ['論点X'] });
		const result = await generateChapterIntroduction(chapter, [mockPersona]);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.selectedAgendaItemIndex).toBe(0);
		}
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
			agenda: ['先頭論点XYZ', '論点2']
		});
		const content = await captureContent(() => generateOpening('テーマ', [mockPersona], chapter));
		expect(content).toContain('先頭論点XYZ');
		expect(content).not.toContain('フォーカス問いの文言');
		expect(content).not.toContain('フォーカス');
	});

	it('generateOpening: 論点を持たない章は章タイトルを入口にする', async () => {
		const { generateOpening } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({ title: '入口タイトル', agenda: [] });
		const content = await captureContent(() => generateOpening('テーマ', [mockPersona], chapter));
		expect(content).toContain('入口タイトル');
	});

	it('generateChapterIntroduction: 先頭論点を入口にし focusQuestion を二重提示しない', async () => {
		const { generateChapterIntroduction } = await import('../../agents/facilitator-agent.js');
		const chapter = makeChapter({
			agenda: ['先頭論点XYZ', '論点2']
		});
		const content = await captureContent(() => generateChapterIntroduction(chapter, [mockPersona]));
		expect(content).toContain('先頭論点XYZ');
		expect(content).not.toContain('フォーカス問いの文言');
		expect(content).not.toContain('フォーカス');
	});
});

describe('オープニング/導入で関連参加者を要求しない（4.3）', () => {
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

	it('generateOpening: 返却に relevantPersonaIds を含めない', async () => {
		generateObject.mockResolvedValueOnce(
			makeObjectResult({ targetPersonaId: 'p1', content: '問いかけ' })
		);
		const { generateOpening } = await import('../../agents/facilitator-agent.js');
		const result = await generateOpening(
			'テーマ',
			[mockPersona],
			makeChapter({ agenda: ['論点1'] })
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).not.toHaveProperty('relevantPersonaIds');
		}
	});

	it('generateOpening: プロンプトが関連参加者リストの生成を要求しない', async () => {
		const content = await captureContent(() =>
			import('../../agents/facilitator-agent.js').then(({ generateOpening }) =>
				generateOpening('テーマ', [mockPersona], makeChapter({ agenda: ['論点1'] }))
			)
		);
		expect(content).not.toContain('relevantPersonaIds');
	});

	it('generateChapterIntroduction: プロンプトが関連参加者リストの生成を要求しない', async () => {
		const content = await captureContent(() =>
			import('../../agents/facilitator-agent.js').then(({ generateChapterIntroduction }) =>
				generateChapterIntroduction(makeChapter({ agenda: ['論点1'] }), [mockPersona])
			)
		);
		expect(content).not.toContain('relevantPersonaIds');
	});
});
