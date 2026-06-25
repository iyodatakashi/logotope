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

vi.mock('../../../llm/models.js', () => ({
	getPipelineModel: vi.fn(() => 'mock-structuring-model'),
	getGoogleProvider: mockGetGoogleProvider
}));

const { mockExtractSources, mockResolveSourceUrls } = vi.hoisted(() => ({
	mockExtractSources: vi.fn(() => [{ query: 'q', summary: 's', results: [] }]),
	mockResolveSourceUrls: vi.fn(async () => [{ query: 'q', summary: 's', results: [] }])
}));

vi.mock('../../../search/grounding.js', () => ({
	extractSources: mockExtractSources,
	resolveSourceUrls: mockResolveSourceUrls
}));

const { mockGetChapterById } = vi.hoisted(() => ({ mockGetChapterById: vi.fn() }));

vi.mock('../../../pipeline/debate/chapter.js', () => ({
	getChapterById: mockGetChapterById
}));

const { mockGetTopicById } = vi.hoisted(() => ({ mockGetTopicById: vi.fn() }));

vi.mock('../../../pipeline/topics/topics.js', () => ({
	getTopicById: mockGetTopicById
}));

import type { DebateTurn } from '../../../types/turn.types.js';
import { checkTurn, checkChapter } from '../../../pipeline/fact-check/fact-check-runner.js';

const makeTurn = (overrides: Partial<DebateTurn> = {}): DebateTurn => ({
	id: 'turn1',
	speakerType: 'persona',
	personaId: 'p1',
	content: '日本の人口は2億人である。',
	createdAt: 'TS' as never,
	...overrides
});

const setResolvedSources = (results: Array<{ title: string; url: string }>) => {
	mockResolveSourceUrls.mockResolvedValue([{ query: 'q', summary: 's', results }]);
};

const groundingResult = (uris: string[] = ['https://a.com']) => ({
	text: 'verification text',
	providerMetadata: {
		google: {
			groundingMetadata: {
				groundingChunks: uris.map((uri) => ({ web: { uri, title: uri } })),
				webSearchQueries: ['q']
			}
		}
	}
});

const phase2Result = (findings: unknown[]) => ({ object: { findings } });

beforeEach(() => {
	vi.clearAllMocks();
	mockGetGoogleProvider.mockReturnValue(mockGoogleProvider);
	mockGoogleProvider.mockReturnValue('mock-google-model');
	mockExtractSources.mockReturnValue([{ query: 'q', summary: 's', results: [] }]);
	mockResolveSourceUrls.mockResolvedValue([{ query: 'q', summary: 's', results: [] }]);
	mockGetTopicById.mockResolvedValue({ id: 't1', title: 'ウクライナ情勢と医療' });
});

describe('checkTurn', () => {
	it('context を渡すと Phase1 プロンプトにテーマ・章の文脈を含める', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(phase2Result([]));
		await checkTurn(makeTurn(), {
			topicTitle: 'ウクライナ情勢と医療',
			chapterTitle: '戦時下の医療中立性',
			focusQuestion: '医療は誰を守るのか'
		});
		const args = mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> };
		const prompt = args.messages[0].content;
		expect(prompt).toContain('ウクライナ情勢と医療');
		expect(prompt).toContain('戦時下の医療中立性');
	});

	it('Phase1 を google_search ツール付きで呼ぶ', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(phase2Result([]));
		await checkTurn(makeTurn());
		const args = mockGenerateText.mock.calls[0][0] as { tools?: Record<string, unknown> };
		expect(args.tools?.['google_search']).toBeDefined();
	});

	it('turnId と speakerType を runner が付与する（LLM 出力に依存しない）', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(
			phase2Result([
				{
					claim: '日本の人口は2億人である',
					verdict: 'incorrect',
					correction: '約1.2億人',
					reason: '統計と矛盾',
					sourceIndices: [1]
				}
			])
		);
		const result = await checkTurn(makeTurn({ id: 'turnX', speakerType: 'facilitator' }));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(1);
			expect(result.value[0].turnId).toBe('turnX');
			expect(result.value[0].speakerType).toBe('facilitator');
		}
	});

	it('claim が発言本文の部分文字列でない finding は破棄する', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(
			phase2Result([
				{
					claim: '実際には発言に存在しない主張',
					verdict: 'incorrect',
					correction: 'x',
					reason: 'y',
					sourceIndices: [1]
				}
			])
		);
		const result = await checkTurn(makeTurn());
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});

	it('sourceIndices を解決済み出典に写像する', async () => {
		setResolvedSources([
			{ title: 'https://a.com', url: 'https://a.com' },
			{ title: 'https://b.com', url: 'https://b.com' }
		]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(
			phase2Result([
				{
					claim: '日本の人口は2億人である',
					verdict: 'incorrect',
					correction: '約1.2億人',
					reason: '統計と矛盾',
					sourceIndices: [2]
				}
			])
		);
		const result = await checkTurn(makeTurn());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value[0].sources).toEqual([{ title: 'https://b.com', url: 'https://b.com' }]);
		}
	});

	it('出典が0件の主張は検証不能（unverifiable）になる', async () => {
		setResolvedSources([]);
		mockGenerateText.mockResolvedValueOnce(groundingResult([]));
		mockGenerateObject.mockResolvedValueOnce(
			phase2Result([
				{
					claim: '日本の人口は2億人である',
					verdict: 'incorrect',
					correction: '約1.2億人',
					reason: '統計と矛盾',
					sourceIndices: [1]
				}
			])
		);
		const result = await checkTurn(makeTurn());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value[0].verdict).toBe('unverifiable');
			expect(result.value[0].sources).toEqual([]);
		}
	});

	it('Phase2 が finding を返さなければ空配列になる', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(phase2Result([]));
		const result = await checkTurn(makeTurn());
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});

	it('プロバイダ利用不可なら AI_API_ERROR を返す', async () => {
		mockGetGoogleProvider.mockReturnValueOnce(null);
		const result = await checkTurn(makeTurn());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe('AI_API_ERROR');
	});

	it('Phase1 失敗時は AI_API_ERROR を返す', async () => {
		mockGenerateText.mockRejectedValueOnce(new Error('grounding error'));
		const result = await checkTurn(makeTurn());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe('AI_API_ERROR');
	});
});

describe('checkChapter', () => {
	it('章が存在しなければ NOT_FOUND を返す', async () => {
		mockGetChapterById.mockResolvedValueOnce(null);
		const result = await checkChapter({ topicId: 't1', chapterId: 'missing' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
	});

	it('検索プロバイダ利用不可なら検証せず空 findings の completed 扱いで返す', async () => {
		mockGetChapterById.mockResolvedValueOnce({
			id: 'c1',
			chapterIndex: 0,
			title: 't',
			focusQuestion: 'f',
			discussionPoints: [],
			turns: [makeTurn()],
			status: 'completed'
		});
		mockGetGoogleProvider.mockReturnValue(null);
		const result = await checkChapter({ topicId: 't1', chapterId: 'c1' });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
		expect(mockGenerateText).not.toHaveBeenCalled();
	});

	it('ペルソナ・ファシリテーター双方の発言を検証し findings を集約する', async () => {
		mockGetChapterById.mockResolvedValueOnce({
			id: 'c1',
			chapterIndex: 0,
			title: 't',
			focusQuestion: 'f',
			discussionPoints: [],
			turns: [
				makeTurn({ id: 'tp', speakerType: 'persona', content: 'ペルソナの誤り主張' }),
				makeTurn({ id: 'tf', speakerType: 'facilitator', content: 'ファシの誤り主張' })
			],
			status: 'completed'
		});
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValue(groundingResult());
		mockGenerateObject
			.mockResolvedValueOnce(
				phase2Result([
					{
						claim: 'ペルソナの誤り主張',
						verdict: 'incorrect',
						correction: 'c',
						reason: 'r',
						sourceIndices: [1]
					}
				])
			)
			.mockResolvedValueOnce(
				phase2Result([
					{
						claim: 'ファシの誤り主張',
						verdict: 'incorrect',
						correction: 'c',
						reason: 'r',
						sourceIndices: [1]
					}
				])
			);
		const result = await checkChapter({ topicId: 't1', chapterId: 'c1' });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(2);
			expect(result.value.map((f) => f.turnId).sort()).toEqual(['tf', 'tp']);
		}
		expect(mockGenerateText).toHaveBeenCalledTimes(2);
	});

	it('発言ごとに onTurnFindings を呼ぶ（逐次表示）', async () => {
		mockGetChapterById.mockResolvedValueOnce({
			id: 'c1',
			chapterIndex: 0,
			title: 't',
			focusQuestion: 'f',
			discussionPoints: [],
			turns: [
				makeTurn({ id: 'tp', content: 'ペルソナの誤り主張' }),
				makeTurn({ id: 'tf', speakerType: 'facilitator', content: 'ファシの誤り主張' })
			],
			status: 'completed'
		});
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValue(groundingResult());
		mockGenerateObject
			.mockResolvedValueOnce(
				phase2Result([
					{
						claim: 'ペルソナの誤り主張',
						verdict: 'incorrect',
						correction: 'c',
						reason: 'r',
						sourceIndices: [1]
					}
				])
			)
			.mockResolvedValueOnce(
				phase2Result([
					{
						claim: 'ファシの誤り主張',
						verdict: 'incorrect',
						correction: 'c',
						reason: 'r',
						sourceIndices: [1]
					}
				])
			);
		const onTurn = vi.fn().mockResolvedValue(undefined);
		await checkChapter({ topicId: 't1', chapterId: 'c1' }, onTurn);
		expect(onTurn).toHaveBeenCalledTimes(2);
		expect(onTurn.mock.calls[0][0][0].turnId).toBe('tp');
		expect(onTurn.mock.calls[1][0][0].turnId).toBe('tf');
	});

	it('指摘が0件の発言では onTurnFindings を呼ばない', async () => {
		mockGetChapterById.mockResolvedValueOnce({
			id: 'c1',
			chapterIndex: 0,
			title: 't',
			focusQuestion: 'f',
			discussionPoints: [],
			turns: [makeTurn({ id: 'tp' })],
			status: 'completed'
		});
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValue(groundingResult());
		mockGenerateObject.mockResolvedValue(phase2Result([]));
		const onTurn = vi.fn().mockResolvedValue(undefined);
		await checkChapter({ topicId: 't1', chapterId: 'c1' }, onTurn);
		expect(onTurn).not.toHaveBeenCalled();
	});

	it('テーマ・章の文脈を検証プロンプトに渡す（単独発言で文脈が失われない）', async () => {
		mockGetChapterById.mockResolvedValueOnce({
			id: 'c1',
			chapterIndex: 0,
			title: '戦時下の医療中立性',
			focusQuestion: '医療は誰を守るのか',
			discussionPoints: [],
			turns: [makeTurn({ id: 'tp', content: '名簿を出せと言われたら拒む' })],
			status: 'completed'
		});
		mockGetTopicById.mockResolvedValueOnce({ id: 't1', title: 'ウクライナ情勢と医療' });
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValue(groundingResult());
		mockGenerateObject.mockResolvedValue(phase2Result([]));
		await checkChapter({ topicId: 't1', chapterId: 'c1' });
		const prompt = (mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> })
			.messages[0].content;
		expect(prompt).toContain('ウクライナ情勢と医療');
		expect(prompt).toContain('戦時下の医療中立性');
	});
});
