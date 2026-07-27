import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGenerateText, mockGenerateObject } = vi.hoisted(() => ({
	mockGenerateText: vi.fn(),
	mockGenerateObject: vi.fn()
}));

vi.mock('ai', () => ({
	generateText: mockGenerateText,
	generateObject: mockGenerateObject
}));

const { mockGetGoogleProvider, mockGoogleProvider, mockGoogleSearch } = vi.hoisted(() => {
	const mockGoogleSearch = vi.fn(() => ({ name: 'google_search', type: 'provider-defined' }));
	const mockGoogleProvider = Object.assign(
		vi.fn(() => 'mock-google-model'),
		{
			tools: { googleSearch: mockGoogleSearch }
		}
	);
	return {
		mockGetGoogleProvider: vi.fn(() => mockGoogleProvider),
		mockGoogleProvider,
		mockGoogleSearch
	};
});

vi.mock('../../llm/models.js', () => ({
	getPipelineModel: vi.fn(() => 'mock-model'),
	getGoogleProvider: mockGetGoogleProvider
}));

import type { Persona } from '../../types/persona.types.js';
import type { TopicContext } from '../../types/topic.types.js';
import { runInterview } from '../../agents/interview-agent.js';

const mockPersona: Persona = {
	id: 'p1',
	topicId: 'topic1',
	name: '田中太郎',
	age: 40,
	occupation: '会社員',
	stakeholderRole: '一般',
	role: '会社員',
	background: '東京在住',
	interests: 'テクノロジー',
	nationality: '日本',
	engagementLevel: 'moderate',
	selected: true,
	sortOrder: 0,
	interviewRecord: ''
};

const makeDraftBeliefObject = () => ({
	stanceAndGrounds: 'draft-stance',
	coreClaims: 'draft-claims',
	concerns: 'draft-concerns',
	values: 'draft-values',
	compromisePoints: 'draft-compromise',
	changePotential: 'draft-change',
	perceivedFacts: 'draft-perceived-facts'
});

const makeFinalBeliefObject = () => ({
	belief: 'final-belief',
	interviewRecord: 'final-record'
});

const makeGroundingResult = (
	chunks: Array<{ uri: string; title?: string }>,
	queries: string[] = ['test query']
) => ({
	text: 'verification report text',
	providerMetadata: {
		google: {
			groundingMetadata: {
				groundingChunks: chunks.map((c) => ({ web: { uri: c.uri, title: c.title ?? null } })),
				webSearchQueries: queries
			}
		}
	}
});

const setupSuccessfulMocks = (
	chunks: Array<{ uri: string; title?: string }> = [{ uri: 'https://example.com', title: 'Test' }]
) => {
	mockGenerateObject
		.mockResolvedValueOnce({ object: makeDraftBeliefObject() })
		.mockResolvedValueOnce({ object: makeFinalBeliefObject() });
	mockGenerateText.mockResolvedValueOnce(makeGroundingResult(chunks));
};

// redirect 解決は HEAD のみ（body を読まない）ので response.url だけ持つレスポンスでよい
const makeFetchResponse = (url: string) => ({ url }) as unknown as Response;

describe('runInterview', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGoogleSearch.mockReturnValue({ name: 'google_search', type: 'provider-defined' });
		mockGoogleProvider.mockReturnValue('mock-google-model');
		mockGetGoogleProvider.mockReturnValue(mockGoogleProvider);
		// デフォルトはリダイレクトなし（response.url が入力URL）・タイトルなしHTML
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => makeFetchResponse(url))
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe('Phase1: ドラフト信念生成', () => {
		it('generateObjectを検索ツールなしで呼ぶ', async () => {
			setupSuccessfulMocks();
			await runInterview('AIと社会', mockPersona);
			const args = mockGenerateObject.mock.calls[0][0] as { tools?: unknown };
			expect(args.tools).toBeUndefined();
		});

		it('generateObject失敗時はResult.errorを返し後続フェーズを実行しない', async () => {
			mockGenerateObject.mockRejectedValueOnce(new Error('LLM error'));
			const result = await runInterview('AIと社会', mockPersona);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe('AI_API_ERROR');
				expect(result.error.retryable).toBe(true);
			}
			expect(mockGenerateText).not.toHaveBeenCalled();
		});
	});

	describe('Phase2: グラウンディング検証', () => {
		it('generateTextをgoogle_searchツール付きで呼ぶ', async () => {
			setupSuccessfulMocks();
			await runInterview('AIと社会', mockPersona);
			expect(mockGenerateText).toHaveBeenCalledOnce();
			const args = mockGenerateText.mock.calls[0][0] as { tools?: Record<string, unknown> };
			expect(args.tools?.['google_search']).toBeDefined();
		});

		it('groundingChunksが空でもエラーにせず、空の出典で後続フェーズを続行する（R6.3/6.5）', async () => {
			mockGenerateObject
				.mockResolvedValueOnce({ object: makeDraftBeliefObject() })
				.mockResolvedValueOnce({ object: makeFinalBeliefObject() });
			mockGenerateText.mockResolvedValueOnce(makeGroundingResult([]));
			const result = await runInterview('AIと社会', mockPersona);
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.value.sources).toEqual([]);
			// Phase3（最終信念生成）も実行される
			expect(mockGenerateObject).toHaveBeenCalledTimes(2);
		});

		it('groundingMetadataがなくてもエラーにせず後続フェーズを続行する', async () => {
			mockGenerateObject
				.mockResolvedValueOnce({ object: makeDraftBeliefObject() })
				.mockResolvedValueOnce({ object: makeFinalBeliefObject() });
			mockGenerateText.mockResolvedValueOnce({ text: 'report', providerMetadata: {} });
			const result = await runInterview('AIと社会', mockPersona);
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.value.sources).toEqual([]);
		});

		it('generateText失敗時はResult.errorを返す', async () => {
			mockGenerateObject.mockResolvedValueOnce({ object: makeDraftBeliefObject() });
			mockGenerateText.mockRejectedValueOnce(new Error('Grounding error'));
			const result = await runInterview('AIと社会', mockPersona);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe('AI_API_ERROR');
				expect(result.error.retryable).toBe(true);
			}
		});
	});

	describe('Phase3: 最終信念生成', () => {
		it('検証レポートを対等な材料として渡し、ドラフト文面は下敷きにしない', async () => {
			mockGenerateObject
				.mockResolvedValueOnce({ object: makeDraftBeliefObject() })
				.mockResolvedValueOnce({ object: makeFinalBeliefObject() });
			mockGenerateText.mockResolvedValueOnce(makeGroundingResult([{ uri: 'https://example.com' }]));
			await runInterview('AIと社会', mockPersona);
			const args = mockGenerateObject.mock.calls[1][0] as {
				messages: Array<{ content: string }>;
			};
			const prompt = args.messages[0].content;
			// 検証レポートは材料として渡る
			expect(prompt).toContain('verification report text');
			// ドラフト信念の文面は Phase3 に渡さない（anchoring 源を断つ）
			expect(prompt).not.toContain('draft-stance');
			expect(prompt).not.toContain('比較参照');
			// 一致点/相違点/新発見を対等な材料として扱う
			expect(prompt).toContain('対等な材料');
		});

		it('generateObject失敗時はResult.errorを返す', async () => {
			mockGenerateObject
				.mockResolvedValueOnce({ object: makeDraftBeliefObject() })
				.mockRejectedValueOnce(new Error('Phase3 error'));
			mockGenerateText.mockResolvedValueOnce(makeGroundingResult([{ uri: 'https://example.com' }]));
			const result = await runInterview('AIと社会', mockPersona);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.code).toBe('AI_API_ERROR');
		});
	});

	describe('パイプライン全体', () => {
		it('全フェーズ成功でInterviewOutputを返す（sources非空）', async () => {
			setupSuccessfulMocks([
				{ uri: 'https://a.com', title: 'A' },
				{ uri: 'https://b.com', title: 'B' }
			]);
			const result = await runInterview('AIと社会', mockPersona);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.interviewRecord).toBe('final-record');
				expect(result.value.belief).toBe('final-belief');
				expect(result.value.sources).toHaveLength(1);
				expect(result.value.sources[0].results).toHaveLength(2);
			}
		});

		it('中間データ（ドラフト信念・検証レポート）も出力に含める', async () => {
			setupSuccessfulMocks();
			const result = await runInterview('AIと社会', mockPersona);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.draftBelief).toEqual(makeDraftBeliefObject());
				expect(result.value.verificationReport).toBe('verification report text');
			}
		});

		it('リダイレクトURLを実URL(フル)に解決し、url・titleともにフルURLにする', async () => {
			setupSuccessfulMocks([
				{ uri: 'https://vertexaisearch.example/redirect/xyz', title: 'example.com' }
			]);
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => makeFetchResponse('https://real-article.example/news/1'))
			);
			const result = await runInterview('AIと社会', mockPersona);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.sources[0].results[0].url).toBe('https://real-article.example/news/1');
				expect(result.value.sources[0].results[0].title).toBe(
					'https://real-article.example/news/1'
				);
			}
		});

		it('解決が失敗したURLは元のURLをurl・titleに使う', async () => {
			setupSuccessfulMocks([
				{ uri: 'https://vertexaisearch.example/redirect/xyz', title: 'example.com' }
			]);
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => {
					throw new Error('network error');
				})
			);
			const result = await runInterview('AIと社会', mockPersona);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.sources[0].results[0].url).toBe(
					'https://vertexaisearch.example/redirect/xyz'
				);
				expect(result.value.sources[0].results[0].title).toBe(
					'https://vertexaisearch.example/redirect/xyz'
				);
			}
		});

		it('topicContextなしでも成功する（後方互換）', async () => {
			setupSuccessfulMocks();
			const result = await runInterview('AIと社会', mockPersona);
			expect(result.ok).toBe(true);
		});

		it('topicContext.descriptionがあればPhase1プロンプトに含める', async () => {
			setupSuccessfulMocks();
			const context: TopicContext = { description: 'AIが雇用を代替する問題' };
			await runInterview('AIと社会', mockPersona, context);
			const args = mockGenerateObject.mock.calls[0][0] as { messages: Array<{ content: string }> };
			expect(args.messages[0].content).toContain('AIが雇用を代替する問題');
		});

		it('topicContext.sourceContentsがあれば参考資料としてPhase1プロンプトに含める', async () => {
			setupSuccessfulMocks();
			const context: TopicContext = { sourceContents: ['記事Aの内容', '記事Bの内容'] };
			await runInterview('AIと社会', mockPersona, context);
			const args = mockGenerateObject.mock.calls[0][0] as { messages: Array<{ content: string }> };
			const prompt = args.messages[0].content;
			expect(prompt).toContain('記事Aの内容');
			expect(prompt).toContain('記事Bの内容');
		});

		it('sourceContentsを3000文字で切り詰める', async () => {
			setupSuccessfulMocks();
			const context: TopicContext = { sourceContents: ['x'.repeat(5000)] };
			await runInterview('AIと社会', mockPersona, context);
			const args = mockGenerateObject.mock.calls[0][0] as { messages: Array<{ content: string }> };
			const prompt = args.messages[0].content;
			expect(prompt).toContain('x'.repeat(3000));
			expect(prompt).not.toContain('x'.repeat(3001));
		});

		it('共有事実基盤を Phase1（ドラフト）に共通前提として注入する', async () => {
			setupSuccessfulMocks();
			const context: TopicContext = {
				factBase: {
					facts: [{ statement: '日本は1回戦で敗退した', sources: [] }],
					generatedAt: new Date('2026-07-03T00:00:00Z')
				}
			};
			await runInterview('AIと社会', mockPersona, context);
			const prompt = (
				mockGenerateObject.mock.calls[0][0] as { messages: Array<{ content: string }> }
			).messages[0].content;
			expect(prompt).toContain('【確定した客観的事実（共通前提）】');
			expect(prompt).toContain('日本は1回戦で敗退した');
		});

		it('グラウンディング検証はテーマ事実を再検索しない旨を明記し、事実基盤を共通前提として渡す', async () => {
			setupSuccessfulMocks();
			const context: TopicContext = {
				factBase: {
					facts: [{ statement: '確定事実X', sources: [] }],
					generatedAt: new Date('2026-07-03T00:00:00Z')
				}
			};
			await runInterview('AIと社会', mockPersona, context);
			const verifyPrompt = (
				mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> }
			).messages[0].content;
			expect(verifyPrompt).toContain('重複検索の禁止');
			expect(verifyPrompt).toContain('確定事実X');
		});

		it('最終信念生成に事実基盤を渡し、関連事実を薄めず反映するよう指示する', async () => {
			setupSuccessfulMocks();
			const context: TopicContext = {
				factBase: {
					facts: [{ statement: '確定事実Y', sources: [] }],
					generatedAt: new Date('2026-07-03T00:00:00Z')
				}
			};
			await runInterview('AIと社会', mockPersona, context);
			const finalPrompt = (
				mockGenerateObject.mock.calls[1][0] as { messages: Array<{ content: string }> }
			).messages[0].content;
			expect(finalPrompt).toContain('一般論に薄めず');
			expect(finalPrompt).toContain('確定事実Y');
		});
	});

	// --- Task 2.1: 立場から見た事実（層②）のドラフトスロット ---
	describe('層②ドラフトスロット（Task 2.1 / R8.1）', () => {
		it('ドラフト生成プロンプトが「立場から見た事実（ペルソナ固有の事実認識）」の推定を指示する', async () => {
			setupSuccessfulMocks();
			await runInterview('AIと社会', mockPersona);
			const draftPrompt = (
				mockGenerateObject.mock.calls[0][0] as { messages: Array<{ content: string }> }
			).messages[0].content;
			expect(draftPrompt).toContain('perceivedFacts');
			expect(draftPrompt).toContain('立場から見た事実');
		});

		it('ドラフト生成の schema に perceivedFacts が含まれる', async () => {
			setupSuccessfulMocks();
			await runInterview('AIと社会', mockPersona);
			const schema = (mockGenerateObject.mock.calls[0][0] as { schema: { shape?: unknown } })
				.schema;
			expect((schema as { shape: Record<string, unknown> }).shape).toHaveProperty('perceivedFacts');
		});
	});

	// --- Task 2.2: グラウンディングの実態志向への再定位（A/B 分離） ---
	describe('グラウンディング再定位（Task 2.2 / R8.1-8.3・6 非破壊）', () => {
		const getVerifyPrompt = async () => {
			setupSuccessfulMocks();
			await runInterview('AIと社会', mockPersona);
			return (mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> })
				.messages[0].content;
		};

		it('検証を「実態・立場から見た事実」の把握に再定位し、真偽の裁定・矯正に使わない旨を含む', async () => {
			const verifyPrompt = await getVerifyPrompt();
			expect(verifyPrompt).toContain('実態');
			expect(verifyPrompt).toContain('立場から見た事実');
			expect(verifyPrompt).toMatch(/裁定|矯正/);
		});

		it('(A) 人物描写の実在感接地を事実認識以外の全次元で維持し紋切り型を外す旨を含む', async () => {
			const verifyPrompt = await getVerifyPrompt();
			expect(verifyPrompt).toContain('紋切り型');
		});

		it('(B) 事実認識を共通見解へ矯正せず層②として帰属保持する旨を含む', async () => {
			const verifyPrompt = await getVerifyPrompt();
			expect(verifyPrompt).toMatch(/共通見解|コンセンサス/);
			expect(verifyPrompt).toContain('帰属');
		});

		it('共有事実の再収集はしない（重複検索の禁止）を維持する', async () => {
			const verifyPrompt = await getVerifyPrompt();
			expect(verifyPrompt).toContain('重複検索の禁止');
		});
	});

	// --- Task 2.3: 最終信念への層②節生成と耐性なし反映 ---
	describe('層②節の生成と耐性なし反映（Task 2.3 / R8.2・8.4-8.6）', () => {
		const getFinalPrompt = async () => {
			setupSuccessfulMocks();
			await runInterview('AIと社会', mockPersona);
			return (mockGenerateObject.mock.calls[1][0] as { messages: Array<{ content: string }> })
				.messages[0].content;
		};

		it('信念ドキュメントに「立場から見た事実」節を生成する指示を含む', async () => {
			const finalPrompt = await getFinalPrompt();
			expect(finalPrompt).toContain('前提としている事実（立場から見た事実）');
		});

		it('相違点・新発見を対等な材料として実態側へ反映し、ステレオタイプに戻さない指示を含む', async () => {
			const finalPrompt = await getFinalPrompt();
			expect(finalPrompt).toContain('対等な材料');
			expect(finalPrompt).toContain('ステレオタイプに戻すのは不可');
		});

		it('層②を共有事実基盤と区別し、共通見解へ均さず帰属保持する旨を含む', async () => {
			const finalPrompt = await getFinalPrompt();
			expect(finalPrompt).toContain('区別');
			expect(finalPrompt).toMatch(/均さ|帰属/);
		});

		it('戯画化・捏造をせず、実態が得られない事実認識は生成しない旨を含む', async () => {
			const finalPrompt = await getFinalPrompt();
			expect(finalPrompt).toMatch(/戯画|捏造/);
		});

		it('層②の種は検証レポートの「立場から見た実態」から採り、ドラフトの perceivedFacts は渡さない', async () => {
			const finalPrompt = await getFinalPrompt();
			expect(finalPrompt).not.toContain('draft-perceived-facts');
			expect(finalPrompt).toContain('立場から見た実態');
		});
	});
});
