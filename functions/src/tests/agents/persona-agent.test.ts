import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Persona } from '../../types/persona.types.js';
import type { Engagement } from '../../types/debate.types.js';
import type { DebateTurn, TurnGenerationContext } from '../../types/turn.types.js';
import type { Chapter } from '../../types/chapter.types.js';

vi.mock('ai', () => ({
	generateText: vi.fn(),
	generateObject: vi.fn(),
	jsonSchema: (schema: unknown) => schema,
	stepCountIs: vi.fn((n: number) => n),
	Output: { object: vi.fn(() => ({})) }
}));

vi.mock('../../llm/models.js', () => ({
	sonnet: 'mock-model'
}));

vi.mock('../../search/search-service.js', () => ({
	isSearchAvailable: vi.fn(() => false),
	executeSearch: vi.fn()
}));

vi.mock('../../utils/prompt-formatters.js', () => ({
	formatTurns: vi.fn(() => '【過去の発言なし】'),
	currentDateString: vi.fn(() => '2026-06-19'),
	// 事実節整形の実体は prompt-formatters.test.ts で検証する。ここでは generateTurn が
	// これを呼び出して結果をプロンプトに含める配線だけを検証するため、最小の整形を返す。
	formatFactBaseSection: vi.fn((factBase?: { facts: { statement: string }[] }) =>
		factBase?.facts?.length
			? `\n\n【確定した客観的事実（共通前提）】\n${factBase.facts.map((f) => f.statement).join('\n')}`
			: ''
	),
	// 気づき節整形の実体は prompt-formatters.test.ts で検証する。ここでは傾聴が
	// 既存の気づきを文脈として注入する配線だけを検証するため、最小の整形を返す。
	formatAwarenessSection: vi.fn((awarenesses?: { content: string }[]) =>
		awarenesses?.length
			? `\n\n【討論中に得た気づき】\n${awarenesses.map((a) => a.content).join('\n')}`
			: ''
	)
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
	selected: true,
	sortOrder: 0,
	interviewRecord: 'テスト取材記録'
};

const mockChapter: Chapter = {
	id: 'ch1',
	title: 'テスト章',
	agenda: []
};

const mockTurns: DebateTurn[] = [];

const makeGenerateTextResult = (output: unknown) => ({ output, steps: [] });

// claude 経路では system は cacheControl 付き SystemModelMessage、gemini/gpt/事後コメントは文字列。
const systemTextOf = (args: { system: unknown }): string =>
	typeof args.system === 'string' ? args.system : (args.system as { content: string }).content;

describe('evaluateEngagement', () => {
	beforeEach(async () => {
		vi.resetModules();
	});

	it('mode: question かつ intentSummary が空の場合、mode: opinion に正規化して返す', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: { score: 4, mode: 'question', intentSummary: '' }
		} as never);

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子', '鈴木次郎']);

		expect(result.mode).toBe('opinion');
		expect(result.score).toBe(4);
	});

	it('mode: question かつ intentSummary が未設定の場合、mode: opinion に正規化して返す', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: { score: 3, mode: 'question' }
		} as never);

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子']);

		expect(result.mode).toBe('opinion');
	});

	it('mode: question かつ intentSummary が非空の場合、そのまま mode: question を返す', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: { score: 4, mode: 'question', intentSummary: '佐藤さんの根拠を聞きたい' }
		} as never);

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子']);

		expect(result.mode).toBe('question');
		expect(result.intentSummary).toBe('佐藤さんの根拠を聞きたい');
	});

	it('otherPersonaNames がプロンプトに含まれる', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateObject).mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return { object: { score: 2, mode: 'opinion', intentSummary: 'テスト' } } as never;
		});

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子', '鈴木次郎']);

		const callArgs = capturedArgs[0] as { messages: Array<{ role: string; content: string }> };
		const userContent = callArgs.messages[0].content;
		expect(userContent).toContain('佐藤花子');
		expect(userContent).toContain('鈴木次郎');
	});

	it('evaluateEngagement が formatTurns に personas を渡す', async () => {
		const formatMod = await import('../../utils/prompt-formatters.js');
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: { score: 3, mode: 'opinion' }
		} as never);

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const personas = [mockPersona];
		await evaluateEngagement(mockPersona, mockTurns, [], personas);

		expect(vi.mocked(formatMod.formatTurns)).toHaveBeenCalledWith(expect.any(Array), personas);
	});

	it('傾聴で気づき（reception）を検出した場合、sourceTurnId（序数）から話者を導出して返す', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: {
				score: 2,
				mode: 'opinion',
				intentSummary: null,
				awareness: {
					kind: 'reception',
					content: '佐藤の指摘には一理あると受け止めた',
					sourceTurnId: '1'
				}
			}
		} as never);

		const turns: DebateTurn[] = [
			{
				id: 't1',
				speakerType: 'persona',
				personaId: 'p2',
				content: '佐藤の発言',
				createdAt: '' as never
			}
		];

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, turns, ['佐藤花子'], [mockPersona]);

		expect(result.awareness).toEqual({
			kind: 'reception',
			content: '佐藤の指摘には一理あると受け止めた',
			sourcePersonaId: 'p2'
		});
	});

	it('気づきが無ければ awareness は null（同意・相槌は気づきにしない）', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: { score: 2, mode: 'opinion', intentSummary: null, awareness: null }
		} as never);

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子']);

		expect(result.awareness).toBeNull();
	});

	it('score 1（none・非話者）でも気づきは検出・保持される', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: {
				score: 1,
				mode: 'none',
				intentSummary: null,
				awareness: { kind: 'self', content: '自分の観点で新しく気づいた', sourceTurnId: null }
			}
		} as never);

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子']);

		expect(result.score).toBe(1);
		expect(result.mode).toBe('none');
		expect(result.awareness).toEqual({
			kind: 'self',
			content: '自分の観点で新しく気づいた',
			sourcePersonaId: null
		});
	});

	it('self の気づきは sourcePersonaId を null に正規化する（sourceTurnId は無視）', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: {
				score: 3,
				mode: 'opinion',
				intentSummary: null,
				awareness: { kind: 'self', content: '自分の気づき', sourceTurnId: '1' }
			}
		} as never);

		const turns: DebateTurn[] = [
			{
				id: 't1',
				speakerType: 'persona',
				personaId: 'p2',
				content: '佐藤の発言',
				createdAt: '' as never
			}
		];

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, turns, ['佐藤花子'], [mockPersona]);

		expect(result.awareness?.sourcePersonaId).toBeNull();
	});

	it('content が空の awareness は null 扱いにする', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: {
				score: 2,
				mode: 'opinion',
				intentSummary: null,
				awareness: { kind: 'reception', content: '   ', sourceTurnId: '1' }
			}
		} as never);

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子']);

		expect(result.awareness).toBeNull();
	});

	it('気づき検出の閾値（結論・立場が動いたときだけ・単なる再認識は除外）と、主判定と分節する旨がプロンプトに含まれる', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateObject).mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return {
				object: { score: 2, mode: 'opinion', intentSummary: null, awareness: null }
			} as never;
		});

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子']);

		const userContent = (capturedArgs[0] as { messages: Array<{ content: string }> }).messages[0]
			.content;
		// 閾値：直前発言で結論・立場そのものが動いたときだけ気づきとする
		expect(userContent).toContain('結論・立場');
		// 単なる再認識（改めて／やはり／再確認／腹落ち）は結論が動いていないので除外する
		expect(userContent).toContain('再確認');
		expect(userContent).toMatch(/改めて|やはり/);
		// 過剰検出を防ぐ既定（該当なし/ほとんどは null）。回数ノルマは設けない
		expect(userContent).toMatch(/該当が無ければ null|ほとんどのターンは null/);
		// score/mode の主判定を変えない
		expect(userContent).toMatch(/判定を変え|独立|切り離|別に行う/);
	});

	it('気づきの発生源を直前発言（提示会話の最後の1発言）のみに限定し、reception は sourceTurnId を申告させる旨がプロンプトに含まれる', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateObject).mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return {
				object: { score: 2, mode: 'opinion', intentSummary: null, awareness: null }
			} as never;
		});

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子']);

		const userContent = (capturedArgs[0] as { messages: Array<{ content: string }> }).messages[0]
			.content;
		// 発生源は末尾＝直前発言のみ。それ以前は文脈にとどめる
		expect(userContent).toContain('直前の発言');
		expect(userContent).toMatch(/最後の1発言|末尾/);
		expect(userContent).toContain('文脈');
		// reception は反応した発言の識別子（sourceTurnId）を出力する
		expect(userContent).toContain('sourceTurnId');
	});

	it('傾聴の会話提示に発言単位のローカル序数（[N]）が付与され、末尾が直前である旨を示す', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateObject).mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return {
				object: { score: 2, mode: 'opinion', intentSummary: null, awareness: null }
			} as never;
		});

		const turns: DebateTurn[] = [
			{
				id: 't1',
				speakerType: 'persona',
				personaId: 'p2',
				content: '一つ目',
				createdAt: '' as never
			},
			{
				id: 't2',
				speakerType: 'persona',
				personaId: 'p3',
				content: '二つ目',
				createdAt: '' as never
			}
		];

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		await evaluateEngagement(mockPersona, turns, ['佐藤花子']);

		const userContent = (capturedArgs[0] as { messages: Array<{ content: string }> }).messages[0]
			.content;
		expect(userContent).toContain('[1]');
		expect(userContent).toContain('[2]');
		// 末尾＝直前の発言であることを提示に明示
		expect(userContent).toContain('直前');
	});

	it('reception が直前発言（末尾）を指すとき採用し、直前話者へ帰属する（1.2）', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: {
				score: 2,
				mode: 'opinion',
				intentSummary: null,
				awareness: { kind: 'reception', content: '一理ある', sourceTurnId: '2' }
			}
		} as never);

		const turns: DebateTurn[] = [
			{
				id: 't1',
				speakerType: 'persona',
				personaId: 'p2',
				content: '一つ目',
				createdAt: '' as never
			},
			{
				id: 't2',
				speakerType: 'persona',
				personaId: 'p3',
				content: '二つ目（直前）',
				createdAt: '' as never
			}
		];

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, turns, ['佐藤花子'], [mockPersona]);

		expect(result.awareness).toEqual({
			kind: 'reception',
			content: '一理ある',
			sourcePersonaId: 'p3'
		});
	});

	it('reception が直前より前の発言を指すとき drop（null）する（1.2）', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: {
				score: 2,
				mode: 'opinion',
				intentSummary: null,
				awareness: { kind: 'reception', content: '一理ある', sourceTurnId: '1' }
			}
		} as never);

		const turns: DebateTurn[] = [
			{
				id: 't1',
				speakerType: 'persona',
				personaId: 'p2',
				content: '一つ目',
				createdAt: '' as never
			},
			{
				id: 't2',
				speakerType: 'persona',
				personaId: 'p3',
				content: '二つ目（直前）',
				createdAt: '' as never
			}
		];

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, turns, ['佐藤花子'], [mockPersona]);

		expect(result.awareness).toBeNull();
	});

	it('同一話者が直前と過去の両方に登場しても、過去発言を指す reception は drop する（1.2）', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: {
				score: 2,
				mode: 'opinion',
				intentSummary: null,
				// 過去（[1]）の p2 発言を指す。直前（[3]）も同じ p2 だが、発言粒度で突合し drop する
				awareness: { kind: 'reception', content: '一理ある', sourceTurnId: '1' }
			}
		} as never);

		const turns: DebateTurn[] = [
			{
				id: 't1',
				speakerType: 'persona',
				personaId: 'p2',
				content: '過去',
				createdAt: '' as never
			},
			{ id: 't2', speakerType: 'persona', personaId: 'p3', content: '間', createdAt: '' as never },
			{
				id: 't3',
				speakerType: 'persona',
				personaId: 'p2',
				content: '直前',
				createdAt: '' as never
			}
		];

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, turns, ['佐藤花子'], [mockPersona]);

		expect(result.awareness).toBeNull();
	});

	it('直前発言の話者が評価対象ペルソナ自身のとき、気づきを無し（null）にする（リスナー限定ガード・1.2）', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: {
				score: 3,
				mode: 'opinion',
				intentSummary: null,
				awareness: { kind: 'reception', content: '自分の発言への気づき', sourceTurnId: '1' }
			}
		} as never);

		// 直前発言が評価対象 p1 自身
		const turns: DebateTurn[] = [
			{
				id: 't1',
				speakerType: 'persona',
				personaId: 'p1',
				content: '自分の発言',
				createdAt: '' as never
			}
		];

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, turns, ['佐藤花子'], [mockPersona]);

		expect(result.awareness).toBeNull();
	});

	it('直前発言がファシリテーター（personaId なし）で一致した reception は sourcePersonaId が null で採用される（1.2）', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: {
				score: 2,
				mode: 'opinion',
				intentSummary: null,
				awareness: { kind: 'reception', content: '問いかけで気づいた', sourceTurnId: '1' }
			}
		} as never);

		const turns: DebateTurn[] = [
			{
				id: 't1',
				speakerType: 'facilitator',
				personaId: null,
				content: 'ファシリの問い',
				createdAt: '' as never
			}
		];

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, turns, ['佐藤花子'], [mockPersona]);

		expect(result.awareness).toEqual({
			kind: 'reception',
			content: '問いかけで気づいた',
			sourcePersonaId: null
		});
	});

	it('reception で sourceTurnId が範囲外・null のとき drop（null）する', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: {
				score: 2,
				mode: 'opinion',
				intentSummary: null,
				awareness: { kind: 'reception', content: '一理ある', sourceTurnId: '99' }
			}
		} as never);

		const turns: DebateTurn[] = [
			{
				id: 't1',
				speakerType: 'persona',
				personaId: 'p2',
				content: '一つ目',
				createdAt: '' as never
			}
		];

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, turns, ['佐藤花子'], [mockPersona]);

		expect(result.awareness).toBeNull();
	});

	it('self の気づきは直前発言を聞いたことを契機に維持される（sourcePersonaId null・1.2）', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: {
				score: 2,
				mode: 'opinion',
				intentSummary: null,
				awareness: { kind: 'self', content: '自分の中で気づいた', sourceTurnId: null }
			}
		} as never);

		const turns: DebateTurn[] = [
			{ id: 't1', speakerType: 'persona', personaId: 'p2', content: '直前', createdAt: '' as never }
		];

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, turns, ['佐藤花子'], [mockPersona]);

		expect(result.awareness).toEqual({
			kind: 'self',
			content: '自分の中で気づいた',
			sourcePersonaId: null
		});
	});

	it('気づきの採否（drop / 採用）に関わらず score/mode/intentSummary の解決は不変（Req4.1 非干渉）', async () => {
		const aiMod = await import('ai');
		// 直前より前を指す reception（drop される）と、直前を指す reception（採用される）で、
		// 同一の score/mode/intentSummary 入力に対する解決結果が一致することを確認する
		const turns: DebateTurn[] = [
			{
				id: 't1',
				speakerType: 'persona',
				personaId: 'p2',
				content: '過去',
				createdAt: '' as never
			},
			{ id: 't2', speakerType: 'persona', personaId: 'p3', content: '直前', createdAt: '' as never }
		];

		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: {
				score: 4,
				mode: 'question',
				intentSummary: '佐藤さんの根拠を聞きたい',
				awareness: { kind: 'reception', content: '過去への反応', sourceTurnId: '1' }
			}
		} as never);
		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const dropped = await evaluateEngagement(mockPersona, turns, ['佐藤花子'], [mockPersona]);

		vi.resetModules();
		const aiMod2 = await import('ai');
		vi.mocked(aiMod2.generateObject).mockResolvedValueOnce({
			object: {
				score: 4,
				mode: 'question',
				intentSummary: '佐藤さんの根拠を聞きたい',
				awareness: { kind: 'reception', content: '直前への反応', sourceTurnId: '2' }
			}
		} as never);
		const { evaluateEngagement: evaluateEngagement2 } =
			await import('../../agents/persona-agent.js');
		const adopted = await evaluateEngagement2(mockPersona, turns, ['佐藤花子'], [mockPersona]);

		// 気づきは一方が null（drop）・他方が採用と分かれるが、score/mode/intentSummary は同一
		expect(dropped.awareness).toBeNull();
		expect(adopted.awareness).not.toBeNull();
		expect(dropped.score).toBe(adopted.score);
		expect(dropped.mode).toBe(adopted.mode);
		expect(dropped.intentSummary).toBe(adopted.intentSummary);
		expect(adopted.score).toBe(4);
		expect(adopted.mode).toBe('question');
		expect(adopted.intentSummary).toBe('佐藤さんの根拠を聞きたい');
	});

	it('既存の気づきを傾聴の入力（文脈）として注入する', async () => {
		const formatMod = await import('../../utils/prompt-formatters.js');
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: { score: 2, mode: 'opinion', intentSummary: null, awareness: null }
		} as never);

		const personaWithAwareness: Persona = {
			...mockPersona,
			awarenesses: [
				{
					id: 'a1',
					kind: 'self',
					content: '既存の気づき',
					sourcePersonaId: null,
					triggeredByTurnId: 't1',
					createdAt: 'TS' as never
				}
			]
		};

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		await evaluateEngagement(personaWithAwareness, mockTurns, ['佐藤花子']);

		expect(vi.mocked(formatMod.formatAwarenessSection)).toHaveBeenCalledWith(
			personaWithAwareness.awarenesses
		);
	});
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
			{ id: 'p3', name: '鈴木次郎' }
		],
		...extras
	});

	const makeEngagement = (override?: Partial<Engagement>): Engagement => ({
		personaId: 'p1',
		score: 4,
		mode: 'question',
		intentSummary: '佐藤さんの意見の根拠を確認したい',
		...override
	});

	it('question モードのとき questionInstruction がプロンプトに含まれる', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: '佐藤さん、なぜそう思うんですか？' }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		const result = await generateTurn(mockPersona, makeContext(), makeEngagement());

		expect(result.ok).toBe(true);
		const callArgs = capturedArgs[0] as { messages: Array<{ role: string; content: string }> };
		const userContent = callArgs.messages[0].content;
		expect(userContent).toContain('佐藤さんの意見の根拠を確認したい');
		expect(userContent).toContain('targetPersonaId');
	});

	it('出力が空でも別モデルへフォールバックせず、generateText は1回のみでエラー Result を返す（3.1/3.2）', async () => {
		const aiMod = await import('ai');
		const spy = vi.mocked(aiMod.generateText);
		spy.mockClear();
		spy.mockImplementation(async () => makeGenerateTextResult(undefined) as never);

		const { generateTurn } = await import('../../agents/persona-agent.js');
		// llmType の値に依存せず単一モデルで生成し、フォールバック再試行をしないことを確認する。
		const result = await generateTurn(
			{ ...mockPersona, llmType: 'gpt' } as Persona,
			makeContext(),
			makeEngagement()
		);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe('AI_API_ERROR');
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('activeAgendaItem があるとき論点がプロンプトに注入される', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: 'テスト発言' }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn(
			mockPersona,
			makeContext({ activeAgendaItem: '在宅勤務は生産性を上げるか' }),
			makeEngagement({ mode: 'opinion', intentSummary: '意見を述べたい' })
		);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		expect(callArgs.messages[0].content).toContain('在宅勤務は生産性を上げるか');
		expect(callArgs.messages[0].content).toContain('いま向き合う論点');
		// 発言者文脈に focusQuestion を含めない（5.2）
		expect(callArgs.messages[0].content).not.toContain('テスト質問？');
	});

	it('factBase を共通前提として注入し、件数ノルマなし・暗唱回避の関与指針を添える（R8）', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: 'テスト発言' }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn(
			mockPersona,
			makeContext({
				factBase: {
					facts: [{ statement: '日本は1回戦で敗退した', sources: [] }],
					generatedAt: new Date('2026-07-03T00:00:00Z')
				}
			}),
			makeEngagement({ mode: 'opinion', intentSummary: '意見を述べたい' })
		);

		const userContent = (capturedArgs[0] as { messages: Array<{ content: string }> }).messages[0]
			.content;
		expect(userContent).toContain('【確定した客観的事実（共通前提）】');
		expect(userContent).toContain('日本は1回戦で敗退した');
		expect(userContent).toContain('件数ノルマもありません');
	});

	it('事実注記が層②優先（衝突点限定・自分の見方を優先し再解釈）を一体文言で含む（Task 3 / R8.8-8.9）', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: 'テスト発言' }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn(
			mockPersona,
			makeContext({
				factBase: {
					facts: [{ statement: '日本は1回戦で敗退した', sources: [] }],
					generatedAt: new Date('2026-07-03T00:00:00Z')
				}
			}),
			makeEngagement({ mode: 'opinion', intentSummary: '意見を述べたい' })
		);

		const userContent = (capturedArgs[0] as { messages: Array<{ content: string }> }).messages[0]
			.content;
		// 衝突点に限定して自分の認識を優先し、共有側を自分の立場から再解釈する一体文言
		expect(userContent).toContain('食い違う');
		expect(userContent).toContain('優先');
		expect(userContent).toContain('再解釈');
	});

	it('factBase が無いとき事実節を注入しない（従来どおり）', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: 'テスト発言' }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn(mockPersona, makeContext(), makeEngagement({ mode: 'opinion' }));

		const userContent = (capturedArgs[0] as { messages: Array<{ content: string }> }).messages[0]
			.content;
		expect(userContent).not.toContain('【確定した客観的事実（共通前提）】');
	});

	it('activeAgendaItem が無いとき章タイトルを場のテーマとして提示し、focusQuestion は含めない', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: 'テスト発言' }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn(mockPersona, makeContext(), makeEngagement({ mode: 'opinion' }));

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		const content = callArgs.messages[0].content;
		expect(content).not.toContain('いま向き合う論点');
		// アクティブ論点不在時は章タイトルがテーマとして入る
		expect(content).toContain('テスト章');
		// focusQuestion は提示しない
		expect(content).not.toContain('テスト質問？');
	});

	it('question モードのとき speechMode: question を返す', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateText).mockResolvedValue(
			makeGenerateTextResult({
				content: '佐藤さん、なぜそう思うんですか？',
				targetPersonaId: 'p2'
			}) as never
		);

		const { generateTurn } = await import('../../agents/persona-agent.js');
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
			return makeGenerateTextResult({ content: 'テスト発言' }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn(
			mockPersona,
			makeContext(),
			makeEngagement({ mode: 'opinion', intentSummary: '意見を述べたい' })
		);

		const callArgs = capturedArgs[0] as { messages: Array<{ role: string; content: string }> };
		const userContent = callArgs.messages[0].content;
		expect(userContent).not.toContain('必ず targetPersonaId に質問相手のIDを指定');
	});

	it('otherPersonas が context にある場合、参加者の名前とIDがプロンプトに含まれる', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: 'テスト', targetPersonaId: 'p2' }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn(mockPersona, makeContext(), makeEngagement());

		const callArgs = capturedArgs[0] as { messages: Array<{ role: string; content: string }> };
		const userContent = callArgs.messages[0].content;
		expect(userContent).toContain('佐藤花子');
		expect(userContent).toContain('p2');
	});

	it('opinion モードで、既定は指名せず場全体へ話す旨（過剰指名抑制 R6.1）がプロンプトに含まれる', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: 'テスト発言' }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn(
			mockPersona,
			makeContext(),
			makeEngagement({ mode: 'opinion', intentSummary: '意見を述べたい' })
		);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		expect(callArgs.messages[0].content).toMatch(/既定は未指定|場全体/);
	});

	it('ペルソナに指名された発言では、直前話者への再指名が往復を固定する旨の注意（R6.2）が含まれる', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: 'テスト発言' }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn(
			mockPersona,
			makeContext({
				targetedBy: 'persona',
				chapterTurns: [
					{
						id: 't0',
						speakerType: 'persona',
						personaId: 'p2',
						content: '佐藤の発言',
						createdAt: ''
					}
				]
			}),
			makeEngagement({ mode: 'opinion', intentSummary: '意見を述べたい' })
		);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		expect(callArgs.messages[0].content).toMatch(/往復|固定/);
	});

	it('generateTurn が formatTurns に personas を渡す', async () => {
		const formatMod = await import('../../utils/prompt-formatters.js');
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateText).mockImplementationOnce(
			async () => makeGenerateTextResult({ content: 'テスト' }) as never
		);

		const { generateTurn } = await import('../../agents/persona-agent.js');
		const personas = [mockPersona];
		await generateTurn(mockPersona, makeContext(), makeEngagement({ mode: 'opinion' }), personas);

		expect(vi.mocked(formatMod.formatTurns)).toHaveBeenCalledWith(expect.any(Array), personas);
	});

	it('factCheckFeedback 指定時、指摘（主張・訂正・理由）と修正方針がプロンプト末尾に付与される', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: '補正後の発言' }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn(
			mockPersona,
			makeContext({
				factCheckFeedback: [
					{
						claim: '日本の人口は2億人である',
						verdict: 'incorrect',
						correction: '約1.2億人である',
						reason: '統計と矛盾するため'
					}
				]
			}),
			makeEngagement({ mode: 'opinion' })
		);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		const userContent = callArgs.messages[0].content;
		expect(userContent).toContain('事実確認による修正指示');
		expect(userContent).toContain('日本の人口は2億人である');
		expect(userContent).toContain('約1.2億人である');
		expect(userContent).toContain('統計と矛盾するため');
		// 立場・口調・論旨・指名の整合維持と結論変化の許容
		expect(userContent).toContain('論旨の方向性');
		expect(userContent).toContain('結論が変わることは許容');
	});

	it('検証不能（unverifiable）の指摘は不確実性を含む表現に改めるか取り下げる方針を伝える', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: '補正後の発言' }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn(
			mockPersona,
			makeContext({
				factCheckFeedback: [
					{
						claim: '来年には完全に普及している',
						verdict: 'unverifiable',
						correction: '',
						reason: '裏付けとなる情報が見つからない'
					}
				]
			}),
			makeEngagement({ mode: 'opinion' })
		);

		const userContent = (capturedArgs[0] as { messages: Array<{ content: string }> }).messages[0]
			.content;
		expect(userContent).toContain('検証不能');
		expect(userContent).toContain('不確実性');
		expect(userContent).toContain('取り下げる');
	});

	it('システムプロンプトは不変の信念（beliefs[0]）を主軸に用い、後続 version の信念は用いない', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: 'テスト発言' }) as never;
		});

		const personaWithBeliefs: Persona = {
			...mockPersona,
			beliefs: [
				{ id: 'b0', version: 0, content: '初期の信念テキスト', createdAt: 'TS' as never },
				{ id: 'b1', version: 1, content: '上書きされた最新信念', createdAt: 'TS' as never }
			]
		};

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn(personaWithBeliefs, makeContext(), makeEngagement({ mode: 'opinion' }));

		const system = systemTextOf(capturedArgs[0] as { system: unknown });
		expect(system).toContain('初期の信念テキスト');
		expect(system).not.toContain('上書きされた最新信念');
	});

	it('蓄積された気づきを発言の入力として反映（消費）し、立場反転しない旨とともに注入する', async () => {
		const formatMod = await import('../../utils/prompt-formatters.js');
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: 'テスト発言' }) as never;
		});

		const personaWithAwareness: Persona = {
			...mockPersona,
			awarenesses: [
				{
					id: 'a1',
					kind: 'reception',
					content: '佐藤の指摘に一理あると受け止めた',
					sourcePersonaId: 'p2',
					triggeredByTurnId: 't1',
					createdAt: 'TS' as never
				}
			]
		};

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn(personaWithAwareness, makeContext(), makeEngagement({ mode: 'opinion' }));

		expect(vi.mocked(formatMod.formatAwarenessSection)).toHaveBeenCalledWith(
			personaWithAwareness.awarenesses
		);
		const userContent = (capturedArgs[0] as { messages: Array<{ content: string }> }).messages[0]
			.content;
		expect(userContent).toContain('佐藤の指摘に一理あると受け止めた');
	});

	it('気づきが無いペルソナでは気づき節を注入しない（従来どおり）', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: 'テスト発言' }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn(mockPersona, makeContext(), makeEngagement({ mode: 'opinion' }));

		const userContent = (capturedArgs[0] as { messages: Array<{ content: string }> }).messages[0]
			.content;
		expect(userContent).not.toContain('【討論中に得た気づき】');
	});

	it('factCheckFeedback 未指定時は修正指示節を付与せず従来どおり生成する', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: 'テスト発言' }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		const result = await generateTurn(
			mockPersona,
			makeContext(),
			makeEngagement({ mode: 'opinion' })
		);

		expect(result.ok).toBe(true);
		const userContent = (capturedArgs[0] as { messages: Array<{ content: string }> }).messages[0]
			.content;
		expect(userContent).not.toContain('事実確認による修正指示');
	});
});

describe('generateImpression', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('システムは不変の信念（beliefs[0]）を主軸に用い、後続 version の信念は用いない', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateObject).mockImplementation(async (args: unknown) => {
			capturedArgs.push(args);
			return { object: { content: 'コメント' } } as never;
		});

		const personaWithBeliefs: Persona = {
			...mockPersona,
			beliefs: [
				{ id: 'b0', version: 0, content: '信念テキスト', createdAt: 'TS' as never },
				{ id: 'b1', version: 1, content: '上書きされた最新信念', createdAt: 'TS' as never }
			]
		};

		const { generateImpression } = await import('../../agents/persona-agent.js');
		await generateImpression(personaWithBeliefs, mockTurns);

		const system = (capturedArgs[0] as { system: string }).system;
		expect(system).toContain('信念テキスト');
		expect(system).not.toContain('上書きされた最新信念');
	});

	it('蓄積された気づきを、討論全文の後・末尾側に置き、それを軸にコメントさせる（末尾＝最終発言にしない）', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateObject).mockImplementation(async (args: unknown) => {
			capturedArgs.push(args);
			return { object: { content: 'コメント' } } as never;
		});

		const personaWithAwareness: Persona = {
			...mockPersona,
			awarenesses: [
				{
					id: 'a1',
					kind: 'self',
					content: '討論で得た気づき',
					sourcePersonaId: null,
					triggeredByTurnId: 't1',
					createdAt: 'TS' as never
				}
			]
		};

		const { generateImpression } = await import('../../agents/persona-agent.js');
		await generateImpression(personaWithAwareness, mockTurns);

		const userContent = (capturedArgs[0] as { messages: Array<{ content: string }> }).messages[0]
			.content;
		// 気づきの内容が入力に反映される
		expect(userContent).toContain('討論で得た気づき');
		// 順序：討論全文 → 気づき（気づきは全文より後ろ＝末尾側に来て、最終発言が末尾にならない）
		expect(userContent.indexOf('討論全文:')).toBeLessThan(userContent.indexOf('討論で得た気づき'));
		// 気づきを軸に、最終発言への反応にしない旨の指示が含まれる
		expect(userContent).toContain('あなた自身の気づき');
		expect(userContent).toContain('最後の発言');
	});

	it('気づきが空でも討論全文から生成する（信念のみにはしない）', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateObject).mockImplementation(async (args: unknown) => {
			capturedArgs.push(args);
			return { object: { content: 'コメント' } } as never;
		});

		const personaNoAwareness: Persona = { ...mockPersona, awarenesses: [] };

		const { generateImpression } = await import('../../agents/persona-agent.js');
		await generateImpression(personaNoAwareness, mockTurns);

		const userContent = (capturedArgs[0] as { messages: Array<{ content: string }> }).messages[0]
			.content;
		expect(userContent).toContain('討論全文:');
		expect(userContent).toContain('最後の発言');
	});
});

// Task 1.1: ペルソナ安定コンテキストのプロンプトキャッシュ配置。
// claude 経路のみ安定コンテキストを cacheControl 付き system メッセージにし、
// 発言・engagement は cacheControl 付き system、事後コメントは従来の文字列 system で呼ぶ。出力スキーマは不変。
describe('プロンプトキャッシュ配置（Task 1.1）', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	const makeContext = (): TurnGenerationContext => ({
		chapterTurns: [],
		chapter: mockChapter,
		otherPersonas: [{ id: 'p2', name: '佐藤花子' }]
	});
	const makeEngagement = (): Engagement => ({
		personaId: 'p1',
		score: 4,
		mode: 'opinion',
		intentSummary: '意見を述べたい'
	});

	// キャッシュ対象の system ブロック（SystemModelMessage）であることを検証する
	const expectCachedSystem = (args: { system: unknown }, expectedContent: string) => {
		const system = args.system as {
			role: string;
			content: string;
			providerOptions: { anthropic: { cacheControl: { type: string } } };
		};
		expect(typeof args.system).toBe('object');
		expect(system.role).toBe('system');
		expect(system.content).toContain(expectedContent);
		expect(system.providerOptions.anthropic.cacheControl.type).toBe('ephemeral');
	};

	it('claude 経路の evaluateEngagement は cacheControl 付き system メッセージで呼ぶ', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateObject).mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return {
				object: { score: 2, mode: 'opinion', intentSummary: null, awareness: null }
			} as never;
		});

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子']);

		expectCachedSystem(capturedArgs[0] as { system: unknown }, '田中太郎');
	});

	it('claude 経路の generateTurn は cacheControl 付き system メッセージで呼ぶ', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: 'テスト発言', targetPersonaId: null }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn(mockPersona, makeContext(), makeEngagement());

		expectCachedSystem(capturedArgs[0] as { system: unknown }, '田中太郎');
	});

	it('legacy llmType 値によらず evaluateEngagement は cacheControl 付き system で呼ぶ（単一 Claude）', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateObject).mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return {
				object: { score: 2, mode: 'opinion', intentSummary: null, awareness: null }
			} as never;
		});

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		await evaluateEngagement({ ...mockPersona, llmType: 'gemini' } as Persona, mockTurns, ['佐藤花子']);

		expectCachedSystem(capturedArgs[0] as { system: unknown }, '田中太郎');
	});

	it('legacy llmType 値によらず generateTurn は cacheControl 付き system で呼ぶ（単一 Claude）', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: 'テスト発言', targetPersonaId: null }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn({ ...mockPersona, llmType: 'gpt' } as Persona, makeContext(), makeEngagement());

		expectCachedSystem(capturedArgs[0] as { system: unknown }, '田中太郎');
	});

	it('generateImpression は claude でも従来の文字列 system で呼ぶ（キャッシュ対象外）', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateObject).mockImplementationOnce(async (args: unknown) => {
			capturedArgs.push(args);
			return { object: { content: 'コメント' } } as never;
		});

		const { generateImpression } = await import('../../agents/persona-agent.js');
		await generateImpression(mockPersona, mockTurns);

		expect(typeof (capturedArgs[0] as { system: unknown }).system).toBe('string');
	});

	it('キャッシュ配置後も出力スキーマは不変（generateTurn: content/targetPersonaId）', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateText).mockResolvedValue(
			makeGenerateTextResult({ content: '発言本文', targetPersonaId: 'p2' }) as never
		);

		const { generateTurn } = await import('../../agents/persona-agent.js');
		const result = await generateTurn(mockPersona, makeContext(), makeEngagement());

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.content).toBe('発言本文');
			expect(result.value.targetPersonaId).toBe('p2');
			expect(result.value.speechMode).toBe('opinion');
		}
	});

	it('キャッシュ配置後も出力スキーマは不変（evaluateEngagement: score/mode/awareness）', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: {
				score: 4,
				mode: 'opinion',
				intentSummary: '別の角度を出したい',
				awareness: { kind: 'self', content: '新たな気づき', sourceTurnId: null }
			}
		} as never);

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子']);

		expect(result.score).toBe(4);
		expect(result.mode).toBe('opinion');
		expect(result.awareness).toEqual({
			kind: 'self',
			content: '新たな気づき',
			sourcePersonaId: null
		});
	});
});
