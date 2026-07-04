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
	getPersonaModel: vi.fn(() => 'mock-model')
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
	llmType: 'claude',
	approved: true,
	sortOrder: 0,
	interviewRecord: 'テスト取材記録'
};

const mockChapter: Chapter = {
	id: 'ch1',
	title: 'テスト章',
	discussionPoints: []
};

const mockTurns: DebateTurn[] = [];

const makeGenerateTextResult = (output: unknown) => ({ output, steps: [] });

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

	it('傾聴で気づき（reception）を検出した場合、awareness をそのまま返す', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: {
				score: 2,
				mode: 'opinion',
				intentSummary: null,
				awareness: {
					kind: 'reception',
					content: '佐藤の指摘には一理あると受け止めた',
					sourcePersonaId: 'p2'
				}
			}
		} as never);

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子']);

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
				awareness: { kind: 'self', content: '自分の観点で新しく気づいた', sourcePersonaId: null }
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

	it('self の気づきは sourcePersonaId を null に正規化する', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: {
				score: 3,
				mode: 'opinion',
				intentSummary: null,
				awareness: { kind: 'self', content: '自分の気づき', sourcePersonaId: 'p2' }
			}
		} as never);

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子']);

		expect(result.awareness?.sourcePersonaId).toBeNull();
	});

	it('content が空の awareness は null 扱いにする', async () => {
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: {
				score: 2,
				mode: 'opinion',
				intentSummary: null,
				awareness: { kind: 'reception', content: '   ', sourcePersonaId: 'p2' }
			}
		} as never);

		const { evaluateEngagement } = await import('../../agents/persona-agent.js');
		const result = await evaluateEngagement(mockPersona, mockTurns, ['佐藤花子']);

		expect(result.awareness).toBeNull();
	});

	it('気づき検出の閾値（同意・相槌は気づきにしない）と、主判定と分節する旨がプロンプトに含まれる', async () => {
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
		// 閾値：単なる同意・相槌は気づきにしない
		expect(userContent).toContain('相槌');
		expect(userContent).toContain('一理');
		// score/mode 判定と分節し、主判定を変えない旨
		expect(userContent).toMatch(/判定を変え|独立|切り離/);
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

	it('activeDiscussionPoint があるとき論点がプロンプトに注入される', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			capturedArgs.push(args);
			return makeGenerateTextResult({ content: 'テスト発言' }) as never;
		});

		const { generateTurn } = await import('../../agents/persona-agent.js');
		await generateTurn(
			mockPersona,
			makeContext({ activeDiscussionPoint: '在宅勤務は生産性を上げるか' }),
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

	it('activeDiscussionPoint が無いとき章タイトルを場のテーマとして提示し、focusQuestion は含めない', async () => {
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

	it('システムプロンプトは不変の初期信念（beliefs[0]）を主軸に用い、後続 version の信念は用いない', async () => {
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

		const system = (capturedArgs[0] as { system: string }).system;
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

describe('generatePostDebateComment', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('システムは不変の初期信念（beliefs[0]）を主軸に用い、後続 version の信念は用いない', async () => {
		const aiMod = await import('ai');
		const capturedArgs: unknown[] = [];
		vi.mocked(aiMod.generateObject).mockImplementation(async (args: unknown) => {
			capturedArgs.push(args);
			return { object: { content: 'コメント' } } as never;
		});

		const personaWithBeliefs: Persona = {
			...mockPersona,
			beliefs: [
				{ id: 'b0', version: 0, content: '初期信念テキスト', createdAt: 'TS' as never },
				{ id: 'b1', version: 1, content: '上書きされた最新信念', createdAt: 'TS' as never }
			]
		};

		const { generatePostDebateComment } = await import('../../agents/persona-agent.js');
		await generatePostDebateComment(personaWithBeliefs, mockTurns);

		const system = (capturedArgs[0] as { system: string }).system;
		expect(system).toContain('初期信念テキスト');
		expect(system).not.toContain('上書きされた最新信念');
	});

	it('蓄積された気づきを事後コメントの入力（揮発部）に反映する', async () => {
		const formatMod = await import('../../utils/prompt-formatters.js');
		const aiMod = await import('ai');
		vi.mocked(aiMod.generateObject).mockResolvedValueOnce({
			object: { content: 'コメント' }
		} as never);

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

		const { generatePostDebateComment } = await import('../../agents/persona-agent.js');
		await generatePostDebateComment(personaWithAwareness, mockTurns);

		expect(vi.mocked(formatMod.formatAwarenessSection)).toHaveBeenCalledWith(
			personaWithAwareness.awarenesses
		);
	});
});
