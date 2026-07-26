import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGenerateText, mockGenerateObject } = vi.hoisted(() => ({
	mockGenerateText: vi.fn(),
	mockGenerateObject: vi.fn()
}));

vi.mock('ai', () => ({
	generateText: mockGenerateText,
	generateObject: mockGenerateObject
}));

const { mockGetGoogleProvider, mockGoogleProvider } = vi.hoisted(() => {
	const mockGoogleSearch = vi.fn(() => ({ name: 'google_search', type: 'provider-defined' }));
	const mockGoogleProvider = Object.assign(
		vi.fn(() => 'mock-google-model'),
		{
			tools: { googleSearch: mockGoogleSearch }
		}
	);
	return {
		mockGetGoogleProvider: vi.fn(() => mockGoogleProvider),
		mockGoogleProvider
	};
});

vi.mock('../../llm/models.js', () => ({
	getPipelineModel: vi.fn(() => 'mock-structuring-model'),
	getGoogleProvider: mockGetGoogleProvider
}));

const { mockExtractSources, mockResolveSourceUrls } = vi.hoisted(() => ({
	mockExtractSources: vi.fn(() => [{ query: 'q', summary: 's', results: [] }]),
	mockResolveSourceUrls: vi.fn(async () => [{ query: 'q', summary: 's', results: [] }])
}));

vi.mock('../../search/grounding.js', () => ({
	extractSources: mockExtractSources,
	resolveSourceUrls: mockResolveSourceUrls
}));

import { runFactResearch } from '../../agents/fact-research-agent.js';

const NOW = new Date('2026-07-03T00:00:00Z');

const setResolvedSources = (results: Array<{ title: string; url: string }>) => {
	mockResolveSourceUrls.mockResolvedValue([{ query: 'q', summary: 's', results }]);
};

const groundingResult = (uris: string[] = ['https://a.com']) => ({
	text: 'grounding text',
	providerMetadata: {
		google: {
			groundingMetadata: {
				groundingChunks: uris.map((uri) => ({ web: { uri, title: uri } })),
				webSearchQueries: ['q']
			}
		}
	}
});

const structured = (facts: unknown[]) => ({ object: { facts } });

beforeEach(() => {
	vi.clearAllMocks();
	mockGetGoogleProvider.mockReturnValue(mockGoogleProvider);
	mockGoogleProvider.mockReturnValue('mock-google-model');
	mockExtractSources.mockReturnValue([{ query: 'q', summary: 's', results: [] }]);
	mockResolveSourceUrls.mockResolvedValue([{ query: 'q', summary: 's', results: [] }]);
});

describe('runFactResearch', () => {
	it('grounding で収集した客観的事実を出典付きで構造化して返す', async () => {
		setResolvedSources([{ title: 'スポーツ報知', url: 'https://sponichi.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(
			structured([{ statement: '日本は決勝トーナメント1回戦で敗退した', sourceIndices: [1] }])
		);

		const result = await runFactResearch('2026年W杯の日本を振り返る', '', NOW);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.facts).toHaveLength(1);
			expect(result.value.facts[0].statement).toBe('日本は決勝トーナメント1回戦で敗退した');
			expect(result.value.facts[0].sources).toEqual([
				{ title: 'スポーツ報知', url: 'https://sponichi.com' }
			]);
		}
	});

	it('生成基準日として渡した now を FactBase.generatedAt に設定する', async () => {
		setResolvedSources([{ title: 'a', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(
			structured([{ statement: '事実', sourceIndices: [1] }])
		);

		const result = await runFactResearch('テーマ', '', NOW);

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.generatedAt).toEqual(NOW);
	});

	it('sourceIndices を解決済み出典に写像する', async () => {
		setResolvedSources([
			{ title: 'a', url: 'https://a.com' },
			{ title: 'b', url: 'https://b.com' }
		]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(
			structured([{ statement: '事実', sourceIndices: [2] }])
		);

		const result = await runFactResearch('テーマ', '', NOW);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.facts[0].sources).toEqual([{ title: 'b', url: 'https://b.com' }]);
		}
	});

	it('grounding が事実を返さない（出典0件）なら捏造せず空の事実基盤を返し、構造化を呼ばない', async () => {
		setResolvedSources([]);
		mockGenerateText.mockResolvedValueOnce(groundingResult([]));

		const result = await runFactResearch('時事性のないテーマ', '', NOW);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.facts).toEqual([]);
			expect(result.value.generatedAt).toEqual(NOW);
		}
		expect(mockGenerateObject).not.toHaveBeenCalled();
	});

	it('grounding を google_search ツール付きで呼ぶ', async () => {
		setResolvedSources([{ title: 'a', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(structured([]));

		await runFactResearch('テーマ', '', NOW);

		const args = mockGenerateText.mock.calls[0][0] as { tools?: Record<string, unknown> };
		expect(args.tools?.['google_search']).toBeDefined();
	});

	it('プロンプトにタイトル・現在日付・客観的事実限定（主観/立場/評価を含めない）を明示する', async () => {
		setResolvedSources([{ title: 'a', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(structured([]));

		await runFactResearch('2026年W杯の日本を振り返る', '', NOW);

		const prompt = (mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> })
			.messages[0].content;
		expect(prompt).toContain('2026年W杯の日本を振り返る');
		expect(prompt).toContain('2026年7月3日');
		expect(prompt).toContain('客観的');
	});

	it('空文字の statement は破棄する', async () => {
		setResolvedSources([{ title: 'a', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(
			structured([
				{ statement: '  ', sourceIndices: [1] },
				{ statement: '有効な事実', sourceIndices: [1] }
			])
		);

		const result = await runFactResearch('テーマ', '', NOW);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.facts).toHaveLength(1);
			expect(result.value.facts[0].statement).toBe('有効な事実');
		}
	});

	it('プロバイダ利用不可なら AI_API_ERROR（retryable:false）を返す', async () => {
		mockGetGoogleProvider.mockReturnValueOnce(null);

		const result = await runFactResearch('テーマ', '', NOW);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('AI_API_ERROR');
			expect(result.error.retryable).toBe(false);
		}
	});

	it('grounding 失敗時は AI_API_ERROR（retryable:true）を返す', async () => {
		mockGenerateText.mockRejectedValueOnce(new Error('grounding error'));

		const result = await runFactResearch('テーマ', '', NOW);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('AI_API_ERROR');
			expect(result.error.retryable).toBe(true);
		}
	});

	// --- Task 1.1: 具体性・網羅性・収集情報の保持 ---
	describe('具体性・網羅性の指示（Task 1.1 / R1・R2・R3）', () => {
		const getPrompts = async () => {
			setResolvedSources([{ title: 'a', url: 'https://a.com' }]);
			mockGenerateText.mockResolvedValueOnce(groundingResult());
			mockGenerateObject.mockResolvedValueOnce(structured([]));
			await runFactResearch('沖縄の基地問題を振り返る', '', NOW);
			const groundingPrompt = (
				mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> }
			).messages[0].content;
			const structuringPrompt = (
				mockGenerateObject.mock.calls[0][0] as { messages: Array<{ content: string }> }
			).messages[0].content;
			return { groundingPrompt, structuringPrompt };
		};

		it('grounding プロンプトが具体（数値・固有名詞・日付・経緯）を薄めず保持する指示を含む', async () => {
			const { groundingPrompt } = await getPrompts();
			expect(groundingPrompt).toContain('経緯');
			expect(groundingPrompt).toContain('一般論');
		});

		it('grounding プロンプトが主要な側面の網羅・恣意的切り詰め禁止を含む', async () => {
			const { groundingPrompt } = await getPrompts();
			expect(groundingPrompt).toContain('網羅');
			expect(groundingPrompt).toContain('恣意的');
			expect(groundingPrompt).toContain('複数');
		});

		it('grounding プロンプトが箇条書きで多数の事実を列挙する網羅レポートを要求する（天井引き上げ）', async () => {
			const { groundingPrompt } = await getPrompts();
			expect(groundingPrompt).toContain('箇条書き');
			expect(groundingPrompt).toContain('10件以上');
		});

		it('structuring プロンプトが grounding の具体情報を保持する指示を含む', async () => {
			const { structuringPrompt } = await getPrompts();
			expect(structuringPrompt).toContain('経緯');
			expect(structuringPrompt).toContain('薄めず');
			expect(structuringPrompt).toContain('網羅');
		});

		it('structuring プロンプトが客観的事実を圧縮せず単位ごとに構造化しつつ主観・立場依存は除外する指示を含む', async () => {
			const { structuringPrompt } = await getPrompts();
			expect(structuringPrompt).toContain('1件へ圧縮しない');
			expect(structuringPrompt).toContain('層②に委ねる');
		});

		it('structuring プロンプトが出典で裏付けられない具体を推測で補わない指示を含む', async () => {
			const { structuringPrompt } = await getPrompts();
			expect(structuringPrompt).toContain('推測');
		});
	});

	// --- Task 1.2: 帰属・観測形と真実非保証 ---
	describe('帰属・観測形と真実非保証の指示（Task 1.2 / R7）', () => {
		const getPrompts = async () => {
			setResolvedSources([{ title: 'a', url: 'https://a.com' }]);
			mockGenerateText.mockResolvedValueOnce(groundingResult());
			mockGenerateObject.mockResolvedValueOnce(structured([]));
			await runFactResearch('北方領土の帰属を巡る問題', '', NOW);
			const groundingPrompt = (
				mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> }
			).messages[0].content;
			const structuringPrompt = (
				mockGenerateObject.mock.calls[0][0] as { messages: Array<{ content: string }> }
			).messages[0].content;
			return { groundingPrompt, structuringPrompt };
		};

		it('structuring プロンプトが立場で分かれる事項を帰属・観測形で記述する指示を含む', async () => {
			const { structuringPrompt } = await getPrompts();
			expect(structuringPrompt).toContain('誰が');
			expect(structuringPrompt).toContain('コンセンサス');
		});

		it('structuring プロンプトが裸の断定・評価的特徴づけ（「係争中」等）を避ける指示を含む', async () => {
			const { structuringPrompt } = await getPrompts();
			expect(structuringPrompt).toContain('係争中');
			expect(structuringPrompt).toContain('断定');
		});

		it('structuring プロンプトが確立事実を否定者の存在ゆえに取り下げない指示を含む', async () => {
			const { structuringPrompt } = await getPrompts();
			expect(structuringPrompt).toContain('否定');
			expect(structuringPrompt).toContain('取り下げ');
		});

		it('structuring プロンプトが検証済みの真実として位置づけない旨を含む', async () => {
			const { structuringPrompt } = await getPrompts();
			expect(structuringPrompt).toContain('検証済み');
		});
	});
});
