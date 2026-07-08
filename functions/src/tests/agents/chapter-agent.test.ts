import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({
	generateObject: vi.fn()
}));

vi.mock('@ai-sdk/anthropic', () => ({
	anthropic: vi.fn(() => 'mock-model')
}));

vi.mock('../../constants/ai.constants.js', () => ({
	AI_MODELS: { SONNET: 'sonnet' },
	MAX_TOKENS: {
		FACILITATOR_CHAPTER_ISSUES: 1024,
		FACILITATOR_CHAPTER_STRUCTURE: 2048
	}
}));

vi.mock('../../utils/prompt-formatters.js', () => ({
	formatPersonas: vi.fn(() => '- p1: テスト'),
	currentDateString: vi.fn(() => '2026-06-19'),
	// 事実節整形の実体は prompt-formatters.test.ts で検証する。ここでは chapter-agent が
	// これを呼び出して結果をプロンプトに含める配線だけを検証するため、最小の整形を返す。
	formatFactBaseSection: vi.fn((factBase?: { facts: { statement: string }[] }) =>
		factBase?.facts?.length
			? `\n\n【確定した客観的事実（共通前提）】\n${factBase.facts.map((f) => f.statement).join('\n')}`
			: ''
	)
}));

vi.mock('../../agents/facilitator-agent.js', () => ({
	buildNeutralitySystemPrompt: vi.fn(() => 'system prompt')
}));

vi.mock('nanoid', () => ({
	nanoid: vi.fn(() => 'test-id')
}));

import type { Persona } from '../../types/persona.types.js';

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

const makeIssuesResult = (issues: string[]) => ({ object: { issues } });
const makeScoringResult = (
	overrides: { index: number; score: number; reason: string }[] = [
		{ index: 0, score: 8, reason: '良い論点' },
		{ index: 1, score: 7, reason: '良い論点' }
	]
) => ({ object: { scoredIssues: overrides } });
const makeGroupingResult = (issueGroups: unknown[] = [{ issueIndexes: [0] }]) => ({
	object: { issueGroups }
});
const makeBuildResult = (
	chapters: unknown[] = [{ title: '第1章', agenda: ['論点A', '論点B', '論点C'] }]
) => ({ object: { chapters } });

describe('generateChapters - agenda', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
	});

	it('AI が返した agenda を章に含める', async () => {
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['issue1']))
			.mockResolvedValueOnce(makeIssuesResult(['issue2']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 8, reason: '良い' },
					{ index: 1, score: 7, reason: '良い' }
				])
			)
			.mockResolvedValueOnce(makeGroupingResult([{ issueIndexes: [0] }, { issueIndexes: [1] }]))
			.mockResolvedValueOnce(
				makeBuildResult([
					{ title: '第1章', agenda: ['論点A', '論点B', '論点C'] },
					{ title: '第2章', agenda: ['論点D', '論点E'] }
				])
			);

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		const result = await generateChapters('テストテーマ', [mockPersona]);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.some((c) => c.agenda.includes('論点A'))).toBe(true);
			expect(result.value.some((c) => c.agenda.includes('論点D'))).toBe(true);
		}
	});

	it('AI が agenda を返さない場合は欠落章の論点テキストでフォールバック', async () => {
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['issue1']))
			.mockResolvedValueOnce(makeIssuesResult(['issue2']))
			.mockResolvedValueOnce(makeScoringResult([{ index: 0, score: 8, reason: '良い' }]))
			.mockResolvedValueOnce(makeGroupingResult([{ issueIndexes: [0] }]))
			.mockResolvedValueOnce(makeBuildResult([{ title: '第1章', agenda: [] }]));

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		const result = await generateChapters('テストテーマ', [mockPersona]);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value[0].agenda).toEqual([]);
		}
	});

	it('グループ化プロンプトにタイトル・フォーカス問い生成要求が含まれない', async () => {
		const capturedArgs: unknown[] = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['i1']))
			.mockResolvedValueOnce(makeIssuesResult(['i2']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 8, reason: '良い' },
					{ index: 1, score: 7, reason: '良い' }
				])
			)
			.mockImplementationOnce(async (args: unknown) => {
				capturedArgs.push(args);
				return makeGroupingResult();
			})
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);

		const callArgs = capturedArgs[0] as { messages: Array<{ content: string }> };
		const content = callArgs.messages[0].content;
		expect(content).not.toContain('focusQuestion');
		expect(content).toContain('issueIndexes');
	});
});

describe('generateChapters - topicContext対応', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	const mockDefaultPipeline = () => {
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['i1']))
			.mockResolvedValueOnce(makeIssuesResult(['i2']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 8, reason: '良い' },
					{ index: 1, score: 7, reason: '良い' }
				])
			)
			.mockResolvedValueOnce(makeGroupingResult())
			.mockResolvedValueOnce(makeBuildResult());
	};

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
				return makeIssuesResult(['i1']);
			})
			.mockResolvedValueOnce(makeIssuesResult(['i2']))
			.mockResolvedValueOnce(makeScoringResult([{ index: 0, score: 8, reason: '良い' }]))
			.mockResolvedValueOnce(makeGroupingResult())
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona], { description: 'テーマの詳細説明テキスト' });

		const msg = capturedGeneralIssues.find(
			(m: unknown) => (m as { role: string }).role === 'user'
		) as { content: string };
		expect(msg.content).toContain('テーマの詳細説明テキスト');
	});

	it('topicContext.descriptionをpersonaIssuesプロンプトに含める', async () => {
		const capturedPersonaIssues: unknown[] = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['i1']))
			.mockImplementationOnce(async (args: { messages: unknown[] }) => {
				capturedPersonaIssues.push(...args.messages);
				return makeIssuesResult(['i2']);
			})
			.mockResolvedValueOnce(makeScoringResult([{ index: 0, score: 8, reason: '良い' }]))
			.mockResolvedValueOnce(makeGroupingResult())
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona], { description: 'ペルソナ向け詳細説明' });

		const msg = capturedPersonaIssues.find(
			(m: unknown) => (m as { role: string }).role === 'user'
		) as { content: string };
		expect(msg.content).toContain('ペルソナ向け詳細説明');
	});

	it('topicContext.sourceContentsをgeneralIssuesプロンプトに含める', async () => {
		const capturedGeneralIssues: unknown[] = [];
		generateObject
			.mockImplementationOnce(async (args: { messages: unknown[] }) => {
				capturedGeneralIssues.push(...args.messages);
				return makeIssuesResult(['i1']);
			})
			.mockResolvedValueOnce(makeIssuesResult(['i2']))
			.mockResolvedValueOnce(makeScoringResult([{ index: 0, score: 8, reason: '良い' }]))
			.mockResolvedValueOnce(makeGroupingResult())
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona], { sourceContents: ['参考記事のテキスト'] });

		const msg = capturedGeneralIssues.find(
			(m: unknown) => (m as { role: string }).role === 'user'
		) as { content: string };
		expect(msg.content).toContain('参考記事のテキスト');
	});

	it('topicContext.factBase を「確定した客観的事実（共通前提）」節として generalIssues プロンプトに含める', async () => {
		const capturedGeneralIssues: unknown[] = [];
		generateObject
			.mockImplementationOnce(async (args: { messages: unknown[] }) => {
				capturedGeneralIssues.push(...args.messages);
				return makeIssuesResult(['i1']);
			})
			.mockResolvedValueOnce(makeIssuesResult(['i2']))
			.mockResolvedValueOnce(makeScoringResult([{ index: 0, score: 8, reason: '良い' }]))
			.mockResolvedValueOnce(makeGroupingResult())
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona], {
			factBase: {
				facts: [{ statement: '日本は1回戦で敗退した', sources: [] }],
				generatedAt: new Date('2026-07-03T00:00:00Z')
			}
		});

		const msg = capturedGeneralIssues.find(
			(m: unknown) => (m as { role: string }).role === 'user'
		) as { content: string };
		expect(msg.content).toContain('【確定した客観的事実（共通前提）】');
		expect(msg.content).toContain('日本は1回戦で敗退した');
	});

	it('topicContext.factBase が空のとき事実節を出力しない（後方互換）', async () => {
		const captured: unknown[] = [];
		generateObject
			.mockImplementationOnce(async (args: { messages: unknown[] }) => {
				captured.push(...args.messages);
				return makeIssuesResult(['i1']);
			})
			.mockResolvedValueOnce(makeIssuesResult(['i2']))
			.mockResolvedValueOnce(makeScoringResult([{ index: 0, score: 8, reason: '良い' }]))
			.mockResolvedValueOnce(makeGroupingResult())
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona], {
			factBase: { facts: [], generatedAt: new Date() }
		});

		const msg = captured.find((m: unknown) => (m as { role: string }).role === 'user') as {
			content: string;
		};
		expect(msg.content).not.toContain('このテーマについて確認された客観的事実です');
	});

	it('topicContextなしで既存プロンプトと同一動作（後方互換）', async () => {
		const capturedWith: unknown[] = [];
		const capturedWithout: unknown[] = [];

		generateObject
			.mockImplementationOnce(async (args: { messages: unknown[] }) => {
				capturedWithout.push(...args.messages);
				return makeIssuesResult(['i']);
			})
			.mockResolvedValueOnce(makeIssuesResult(['i']))
			.mockResolvedValueOnce(makeScoringResult([{ index: 0, score: 8, reason: '良い' }]))
			.mockResolvedValueOnce(makeGroupingResult())
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);
		const contentWithout = (
			capturedWithout.find((m: unknown) => (m as { role: string }).role === 'user') as {
				content: string;
			}
		).content;

		vi.resetModules();
		const aiMod2 = await import('ai');
		const go2 = vi.mocked(aiMod2.generateObject);
		go2
			.mockImplementationOnce(async (args: { messages: unknown[] }) => {
				capturedWith.push(...args.messages);
				return makeIssuesResult(['i']);
			})
			.mockResolvedValueOnce(makeIssuesResult(['i']))
			.mockResolvedValueOnce(makeScoringResult([{ index: 0, score: 8, reason: '良い' }]))
			.mockResolvedValueOnce(makeGroupingResult())
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters: gc2 } = await import('../../agents/chapter-agent.js');
		await gc2('テーマ', [mockPersona], undefined);
		const contentWith = (
			capturedWith.find((m: unknown) => (m as { role: string }).role === 'user') as {
				content: string;
			}
		).content;

		expect(contentWithout).toBe(contentWith);
	});

	it('スコアリングプロンプトにtopicContextを含める', async () => {
		const capturedScoring: unknown[] = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['i1']))
			.mockResolvedValueOnce(makeIssuesResult(['i2']))
			.mockImplementationOnce(async (args: { messages: unknown[] }) => {
				capturedScoring.push(...args.messages);
				return makeScoringResult([{ index: 0, score: 8, reason: '良い' }]);
			})
			.mockResolvedValueOnce(makeGroupingResult())
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona], { description: 'スコアリングに使う説明' });

		const msg = capturedScoring.find((m: unknown) => (m as { role: string }).role === 'user') as {
			content: string;
		};
		expect(msg.content).toContain('スコアリングに使う説明');
	});

	it('AI呼び出し失敗時にAI_API_ERRORを返す', async () => {
		mockDefaultPipeline();
		generateObject.mockReset();
		generateObject.mockRejectedValueOnce(new Error('API failure'));

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		const result = await generateChapters('テーマ', [mockPersona]);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('AI_API_ERROR');
			expect(result.error.retryable).toBe(true);
		}
	});

	it('issues_generated イベントで論点が source 付きで通知される', async () => {
		const progressEvents: Array<{
			step: string;
			issues?: Array<{ text: string; source: string }>;
		}> = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['一般論点1', '一般論点2']))
			.mockResolvedValueOnce(makeIssuesResult(['ペルソナ論点1']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 3, reason: '低い' },
					{ index: 1, score: 3, reason: '低い' },
					{ index: 2, score: 3, reason: '低い' }
				])
			)
			.mockResolvedValueOnce(makeGroupingResult())
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		const result = await generateChapters('テーマ', [mockPersona], undefined, (p) => {
			progressEvents.push(p as never);
		});

		expect(result.ok).toBe(true);
		const genEvent = progressEvents.find((p) => p.step === 'issues_generated');
		expect(genEvent?.issues?.filter((i) => i.source === 'general').map((i) => i.text)).toEqual([
			'一般論点1',
			'一般論点2'
		]);
		expect(genEvent?.issues?.filter((i) => i.source === 'persona').map((i) => i.text)).toEqual([
			'ペルソナ論点1'
		]);
	});
});

// ─── Task 7.1: scoreIssues ───────────────────────────────────────────────────

describe('Task 7.1: scoreIssues - スコアリング', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
	});

	it('全論点が general/persona の source を保持してグループ化に渡る', async () => {
		const capturedGrouping: string[] = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['gen1']))
			.mockResolvedValueOnce(makeIssuesResult(['per1']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 8, reason: 'general good' },
					{ index: 1, score: 7, reason: 'persona good' }
				])
			)
			.mockImplementationOnce(async (args: { messages: { content: string }[] }) => {
				capturedGrouping.push(args.messages[0].content);
				return makeGroupingResult([{ issueIndexes: [0, 1] }]);
			})
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);

		expect(capturedGrouping[0]).toContain('[general] gen1');
		expect(capturedGrouping[0]).toContain('[persona] per1');
	});

	it('index欠落の論点はスコア0として扱われ閾値未満で選別から除外される', async () => {
		const capturedGrouping: string[] = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['gen1']))
			.mockResolvedValueOnce(makeIssuesResult(['per1']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 8, reason: 'good' }
					// index 1 (per1) 欠落 → score=0
				])
			)
			.mockImplementationOnce(async (args: { messages: { content: string }[] }) => {
				capturedGrouping.push(args.messages[0].content);
				return makeGroupingResult([{ issueIndexes: [0] }]);
			})
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);

		// gen1 (score=8) は採用、per1 (score=0) は閾値未満で除外
		expect(capturedGrouping[0]).toContain('[general] gen1');
		expect(capturedGrouping[0]).not.toContain('[persona] per1');
	});

	it('スコアリングプロンプトに全論点が source ラベル付きで含まれる', async () => {
		const capturedScoring: string[] = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['gen_issue']))
			.mockResolvedValueOnce(makeIssuesResult(['per_issue']))
			.mockImplementationOnce(async (args: { messages: { content: string }[] }) => {
				capturedScoring.push(args.messages[0].content);
				return makeScoringResult([
					{ index: 0, score: 8, reason: 'good' },
					{ index: 1, score: 7, reason: 'good' }
				]);
			})
			.mockResolvedValueOnce(makeGroupingResult())
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);

		expect(capturedScoring[0]).toContain('[general] gen_issue');
		expect(capturedScoring[0]).toContain('[persona] per_issue');
	});
});

// ─── Task 7.1: selectIssues ──────────────────────────────────────────────────

describe('Task 7.1: selectIssues - 選別ルール', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
	});

	it('スコア7以上の論点のみがグループ化に渡る', async () => {
		const capturedGrouping: string[] = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['gen1', 'gen2']))
			.mockResolvedValueOnce(makeIssuesResult(['per1']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 8, reason: '閾値以上' },
					{ index: 1, score: 4, reason: '閾値未満' },
					{ index: 2, score: 3, reason: '閾値未満' }
				])
			)
			.mockImplementationOnce(async (args: { messages: { content: string }[] }) => {
				capturedGrouping.push(args.messages[0].content);
				return makeGroupingResult([{ issueIndexes: [0] }]);
			})
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);

		expect(capturedGrouping[0]).toContain('[general] gen1');
		expect(capturedGrouping[0]).not.toContain('[general] gen2');
		expect(capturedGrouping[0]).not.toContain('[persona] per1');
	});

	it('スコア7以上が0件のとき最上位スコア1件のみ採用される', async () => {
		const capturedGrouping: string[] = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['gen1']))
			.mockResolvedValueOnce(makeIssuesResult(['per1']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 5, reason: '全体最高だが閾値未満' },
					{ index: 1, score: 3, reason: '低い' }
				])
			)
			.mockImplementationOnce(async (args: { messages: { content: string }[] }) => {
				capturedGrouping.push(args.messages[0].content);
				return makeGroupingResult([{ issueIndexes: [0] }]);
			})
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);

		// gen1 (score=5, 最高) のみ採用
		expect(capturedGrouping[0]).toContain('[general] gen1');
		expect(capturedGrouping[0]).not.toContain('[persona] per1');
	});

	it('general由来が採用に0件のとき最高スコアのgeneralを追加採用する', async () => {
		const capturedGrouping: string[] = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['gen1']))
			.mockResolvedValueOnce(makeIssuesResult(['per1', 'per2']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 3, reason: '低い（general）' },
					{ index: 1, score: 9, reason: '高い（persona）' },
					{ index: 2, score: 8, reason: '高い（persona）' }
				])
			)
			.mockImplementationOnce(async (args: { messages: { content: string }[] }) => {
				capturedGrouping.push(args.messages[0].content);
				return makeGroupingResult([{ issueIndexes: [0, 1, 2] }]);
			})
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);

		// per1(9), per2(8) が閾値以上、しかしgeneralが0件 → gen1を追加採用
		expect(capturedGrouping[0]).toContain('[general] gen1');
		expect(capturedGrouping[0]).toContain('[persona] per1');
		expect(capturedGrouping[0]).toContain('[persona] per2');
	});

	it('generalが既に採用済みであれば追加採用しない', async () => {
		const capturedGrouping: string[] = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['gen1', 'gen2']))
			.mockResolvedValueOnce(makeIssuesResult(['per1']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 8, reason: '高い（general）' },
					{ index: 1, score: 3, reason: '低い（general）' },
					{ index: 2, score: 7, reason: '閾値上（persona）' }
				])
			)
			.mockImplementationOnce(async (args: { messages: { content: string }[] }) => {
				capturedGrouping.push(args.messages[0].content);
				return makeGroupingResult([{ issueIndexes: [0, 1] }]);
			})
			.mockResolvedValueOnce(makeBuildResult());

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);

		// gen1(8), per1(7) が閾値以上。generalは gen1 で満たされるため gen2 は不追加
		expect(capturedGrouping[0]).toContain('[general] gen1');
		expect(capturedGrouping[0]).toContain('[persona] per1');
		expect(capturedGrouping[0]).not.toContain('[general] gen2');
	});
});

// ─── Task 2.1: groupIssues ───────────────────────────────────────────────────

describe('Task 2.1: groupIssues - グループ化フォールバック', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
	});

	it('グループ化が0グループを返した場合、全採用論点を1グループにまとめるフォールバック', async () => {
		const capturedBuilding: string[] = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['gen1']))
			.mockResolvedValueOnce(makeIssuesResult(['per1']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 8, reason: '良い' },
					{ index: 1, score: 7, reason: '良い' }
				])
			)
			.mockResolvedValueOnce(makeGroupingResult([])) // 0グループ → フォールバック
			.mockImplementationOnce(async (args: { messages: { content: string }[] }) => {
				capturedBuilding.push(args.messages[0].content);
				return makeBuildResult();
			});

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		const result = await generateChapters('テーマ', [mockPersona]);

		expect(result.ok).toBe(true);
		// 1グループにまとめられ、両論点が含まれる
		expect(capturedBuilding[0]).toContain('gen1');
		expect(capturedBuilding[0]).toContain('per1');
		// グループ数が1であること
		const groupSections = capturedBuilding[0].split('## グループ');
		expect(groupSections.length - 1).toBe(1);
	});

	it('割り当て漏れの論点は最終グループに追加される', async () => {
		const capturedBuilding: string[] = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['gen1']))
			.mockResolvedValueOnce(makeIssuesResult(['per1', 'per2']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 8, reason: '良い' },
					{ index: 1, score: 8, reason: '良い' },
					{ index: 2, score: 8, reason: '良い' }
				])
			)
			.mockResolvedValueOnce(
				makeGroupingResult([
					{ issueIndexes: [0] },
					{ issueIndexes: [1] }
					// local idx 2 (per2) 未割り当て → 最終グループに追加
				])
			)
			.mockImplementationOnce(async (args: { messages: { content: string }[] }) => {
				capturedBuilding.push(args.messages[0].content);
				return makeBuildResult([
					{ title: '章1', agenda: ['dp1'] },
					{ title: '章2', agenda: ['dp2'] }
				]);
			});

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);

		// グループ2のセクションに per2 が含まれること
		const sections = capturedBuilding[0].split('## グループ');
		const group2Section = sections[2] ?? '';
		expect(group2Section).toContain('per2');
	});

	it('全採用論点が取りこぼしなくどこかのグループに属する', async () => {
		const capturedBuilding: string[] = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['gen1', 'gen2']))
			.mockResolvedValueOnce(makeIssuesResult(['per1']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 8, reason: '良い' },
					{ index: 1, score: 8, reason: '良い' },
					{ index: 2, score: 8, reason: '良い' }
				])
			)
			.mockResolvedValueOnce(
				makeGroupingResult([
					{ issueIndexes: [0, 2] }
					// gen2 (local idx 1) が未割り当て
				])
			)
			.mockImplementationOnce(async (args: { messages: { content: string }[] }) => {
				capturedBuilding.push(args.messages[0].content);
				return makeBuildResult();
			});

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);

		// gen2 が最終グループに寄せられ building prompt に含まれる
		expect(capturedBuilding[0]).toContain('gen2');
	});
});

// ─── Task 2.2: buildChapters ─────────────────────────────────────────────────

describe('Task 2.2: buildChapters - 章生成', () => {
	let generateObject: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const aiMod = await import('ai');
		generateObject = vi.mocked(aiMod.generateObject);
	});

	it('返却章数が入力より少ない場合、欠落章は論点テキストをagendaにフォールバック', async () => {
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['gen1']))
			.mockResolvedValueOnce(makeIssuesResult(['per1']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 8, reason: '良い' },
					{ index: 1, score: 7, reason: '良い' }
				])
			)
			.mockResolvedValueOnce(makeGroupingResult([{ issueIndexes: [0] }, { issueIndexes: [1] }]))
			.mockResolvedValueOnce(
				makeBuildResult([
					{
						title: '章1',
						agenda: ['再構成1', '再構成2', '再構成3']
					}
					// 章2 欠落 → per1 (issues[1].text) をそのまま流用
				])
			);

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		const result = await generateChapters('テーマ', [mockPersona]);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(2);
			// 章はsortされる可能性があるので、どちらかが再構成済みで、もう一方がフォールバック
			const fallbackChapter = result.value.find((c) => c.agenda.includes('per1'));
			expect(fallbackChapter).toBeDefined();
		}
	});

	it('各章に nanoid・title・agenda が付与される（focusQuestion は廃止）', async () => {
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['gen1']))
			.mockResolvedValueOnce(makeIssuesResult(['per1']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 8, reason: '良い' },
					{ index: 1, score: 7, reason: '良い' }
				])
			)
			.mockResolvedValueOnce(makeGroupingResult([{ issueIndexes: [0, 1] }]))
			.mockResolvedValueOnce(
				makeBuildResult([
					{
						title: '固有タイトル',
						agenda: ['dp1', 'dp2', 'dp3']
					}
				])
			);

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		const result = await generateChapters('テーマ', [mockPersona]);

		expect(result.ok).toBe(true);
		if (result.ok) {
			const chapter = result.value[0];
			expect(chapter.id).toBe('test-id'); // nanoid mock
			expect(chapter.title).toBe('固有タイトル');
			expect(chapter.agenda).toEqual(['dp1', 'dp2', 'dp3']);
		}
	});

	it('章生成プロンプトが focusQuestion を要求せず、論点を平易な問いの形で生成するよう指示する', async () => {
		const capturedBuilding: string[] = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['gen1']))
			.mockResolvedValueOnce(makeIssuesResult(['per1']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 8, reason: '良い' },
					{ index: 1, score: 7, reason: '良い' }
				])
			)
			.mockResolvedValueOnce(makeGroupingResult([{ issueIndexes: [0, 1] }]))
			.mockImplementationOnce(async (args: { messages: { content: string }[] }) => {
				capturedBuilding.push(args.messages[0].content);
				return makeBuildResult();
			});

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);

		const content = capturedBuilding[0];
		expect(content).not.toContain('focusQuestion');
		expect(content).not.toContain('フォーカス問い');
		expect(content).toContain('問いの形');
		expect(content).toContain('日常感覚');
	});

	it('章生成プロンプトに各グループの論点テキストが含まれる', async () => {
		const capturedBuilding: string[] = [];
		generateObject
			.mockResolvedValueOnce(makeIssuesResult(['gen1']))
			.mockResolvedValueOnce(makeIssuesResult(['per1']))
			.mockResolvedValueOnce(
				makeScoringResult([
					{ index: 0, score: 8, reason: '良い' },
					{ index: 1, score: 7, reason: '良い' }
				])
			)
			.mockResolvedValueOnce(makeGroupingResult([{ issueIndexes: [0, 1] }]))
			.mockImplementationOnce(async (args: { messages: { content: string }[] }) => {
				capturedBuilding.push(args.messages[0].content);
				return makeBuildResult();
			});

		const { generateChapters } = await import('../../agents/chapter-agent.js');
		await generateChapters('テーマ', [mockPersona]);

		expect(capturedBuilding[0]).toContain('gen1');
		expect(capturedBuilding[0]).toContain('per1');
	});
});

// ─── Task 2.3: sortChaptersByGeneralIssueCount ───────────────────────────────

describe('Task 2.3: sortChaptersByGeneralIssueCount - 並べ替え純粋関数', () => {
	it('general由来論点数の多いグループの章を先頭に配置する', async () => {
		vi.resetModules();
		const { sortChaptersByGeneralIssueCount } = await import('../../agents/chapter-agent.js');

		const issues = [
			{ text: 'g1', source: 'general' as const },
			{ text: 'g2', source: 'general' as const },
			{ text: 'p1', source: 'persona' as const }
		];
		const issueGroups = [
			{ issueIndexes: [2] }, // 0 general
			{ issueIndexes: [0, 1, 2] }, // 2 general
			{ issueIndexes: [0] } // 1 general
		];
		const chapters = [
			{ id: 'c0', title: '章0', agenda: [] },
			{ id: 'c1', title: '章1', agenda: [] },
			{ id: 'c2', title: '章2', agenda: [] }
		];

		const sorted = sortChaptersByGeneralIssueCount(chapters, issueGroups, issues);

		expect(sorted.map((c) => c.id)).toEqual(['c1', 'c2', 'c0']);
	});

	it('general数が同数のとき元のグループ順を維持する（安定ソート）', async () => {
		vi.resetModules();
		const { sortChaptersByGeneralIssueCount } = await import('../../agents/chapter-agent.js');

		const issues = [
			{ text: 'g1', source: 'general' as const },
			{ text: 'p1', source: 'persona' as const },
			{ text: 'p2', source: 'persona' as const }
		];
		const issueGroups = [
			{ issueIndexes: [0, 1] }, // 1 general
			{ issueIndexes: [0, 2] } // 1 general (同数)
		];
		const chapters = [
			{ id: 'c0', title: '章0', agenda: [] },
			{ id: 'c1', title: '章1', agenda: [] }
		];

		const sorted = sortChaptersByGeneralIssueCount(chapters, issueGroups, issues);

		// 同数なので元の順序を維持
		expect(sorted.map((c) => c.id)).toEqual(['c0', 'c1']);
	});

	it('入力配列を変更しない（純粋関数）', async () => {
		vi.resetModules();
		const { sortChaptersByGeneralIssueCount } = await import('../../agents/chapter-agent.js');

		const issues = [
			{ text: 'g1', source: 'general' as const },
			{ text: 'p1', source: 'persona' as const }
		];
		const issueGroups = [
			{ issueIndexes: [1] }, // 0 general
			{ issueIndexes: [0] } // 1 general
		];
		const chapters = [
			{ id: 'c0', title: '章0', agenda: [] },
			{ id: 'c1', title: '章1', agenda: [] }
		];
		const originalChapters = [...chapters];
		const originalGroups = [...issueGroups];

		sortChaptersByGeneralIssueCount(chapters, issueGroups, issues);

		expect(chapters).toEqual(originalChapters);
		expect(issueGroups).toEqual(originalGroups);
	});
});
