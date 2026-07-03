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

		const result = await runFactResearch('2026年W杯の日本を振り返る', NOW);

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

		const result = await runFactResearch('テーマ', NOW);

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

		const result = await runFactResearch('テーマ', NOW);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.facts[0].sources).toEqual([{ title: 'b', url: 'https://b.com' }]);
		}
	});

	it('grounding が事実を返さない（出典0件）なら捏造せず空の事実基盤を返し、構造化を呼ばない', async () => {
		setResolvedSources([]);
		mockGenerateText.mockResolvedValueOnce(groundingResult([]));

		const result = await runFactResearch('時事性のないテーマ', NOW);

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

		await runFactResearch('テーマ', NOW);

		const args = mockGenerateText.mock.calls[0][0] as { tools?: Record<string, unknown> };
		expect(args.tools?.['google_search']).toBeDefined();
	});

	it('プロンプトにタイトル・現在日付・客観的事実限定（主観/立場/評価を含めない）を明示する', async () => {
		setResolvedSources([{ title: 'a', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(structured([]));

		await runFactResearch('2026年W杯の日本を振り返る', NOW);

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

		const result = await runFactResearch('テーマ', NOW);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.facts).toHaveLength(1);
			expect(result.value.facts[0].statement).toBe('有効な事実');
		}
	});

	it('プロバイダ利用不可なら AI_API_ERROR（retryable:false）を返す', async () => {
		mockGetGoogleProvider.mockReturnValueOnce(null);

		const result = await runFactResearch('テーマ', NOW);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('AI_API_ERROR');
			expect(result.error.retryable).toBe(false);
		}
	});

	it('grounding 失敗時は AI_API_ERROR（retryable:true）を返す', async () => {
		mockGenerateText.mockRejectedValueOnce(new Error('grounding error'));

		const result = await runFactResearch('テーマ', NOW);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('AI_API_ERROR');
			expect(result.error.retryable).toBe(true);
		}
	});
});
