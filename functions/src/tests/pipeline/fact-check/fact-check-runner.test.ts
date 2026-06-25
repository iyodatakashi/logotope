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

const { mockCurrentDateString } = vi.hoisted(() => ({
	mockCurrentDateString: vi.fn(() => '2026年6月25日')
}));

vi.mock('../../../utils/prompt-formatters.js', () => ({
	currentDateString: mockCurrentDateString
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
			focusQuestion: '医療は誰を守るのか',
			currentDate: '2026年6月25日'
		});
		const args = mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> };
		const prompt = args.messages[0].content;
		expect(prompt).toContain('ウクライナ情勢と医療');
		expect(prompt).toContain('戦時下の医療中立性');
	});

	it('context の currentDate を本日として Phase1 プロンプトに注入し時間軸検証を指示する', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(phase2Result([]));
		await checkTurn(makeTurn(), {
			topicTitle: 'T',
			chapterTitle: 'C',
			focusQuestion: 'F',
			currentDate: '2026年6月25日'
		});
		const args = mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> };
		const prompt = args.messages[0].content;
		expect(prompt).toContain('2026年6月25日');
		expect(prompt).toContain('時間軸');
	});

	it('Phase1 プロンプトに断定性の検証範囲（断定のみ検証・問い/前提/仮定/代弁は対象外・最新事実・不確実なら断定）を含める', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(phase2Result([]));
		await checkTurn(makeTurn());
		const prompt = (mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> })
			.messages[0].content;
		expect(prompt).toContain('事実として断定された主張');
		expect(prompt).toContain('代弁');
		expect(prompt).toContain('質問文中でも');
		expect(prompt).toContain('最新の事実');
		expect(prompt).toContain('不確実');
	});

	it('speechMode が question のとき Phase1 プロンプトに問いかけの手掛かりを付すが一律除外しない旨を明記する', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(phase2Result([]));
		await checkTurn(makeTurn({ speechMode: 'question' }));
		const prompt = (mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> })
			.messages[0].content;
		expect(prompt).toContain('質問モードのシグナル');
		expect(prompt).toContain('一律に検証対象外としない');
	});

	it('speechMode が question 以外のとき質問モードの手掛かりは付さない', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(phase2Result([]));
		await checkTurn(makeTurn({ speechMode: 'fact' }));
		const prompt = (mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> })
			.messages[0].content;
		expect(prompt).not.toContain('質問モードのシグナル');
	});

	it('Phase2 プロンプトに非断定の抑制ルール（断定のみ指摘・別概念・主張ごと判定・不確実なら断定）を含める', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(phase2Result([]));
		await checkTurn(makeTurn());
		const prompt = (mockGenerateObject.mock.calls[0][0] as { messages: Array<{ content: string }> })
			.messages[0].content;
		expect(prompt).toContain('事実として断定された主張のみを指摘');
		expect(prompt).toContain('finding を生成しない');
		expect(prompt).toContain('別概念');
		expect(prompt).toContain('主張ごとに判定');
		expect(prompt).toContain('不確実');
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

	it('実行開始時の本日（currentDateString）を検証コンテキストに渡す', async () => {
		mockCurrentDateString.mockReturnValueOnce('2026年6月25日');
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
		expect(prompt).toContain('2026年6月25日');
	});
});

describe('checkTurn 判定妥当性（シナリオ）', () => {
	const ctx = {
		topicTitle: 'ウクライナ情勢と医療',
		chapterTitle: '戦時下の医療中立性',
		focusQuestion: '医療は誰を守るのか',
		currentDate: '2026年6月25日'
	};
	const phase1Prompt = () =>
		(mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0]
			.content;

	it('問いかけの前提として述べた事実主張は指摘されない（停戦の前提）', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		// 非断定（問いかけの前提）と判断され Phase2 は finding を生成しない
		mockGenerateObject.mockResolvedValueOnce(phase2Result([]));
		const result = await checkTurn(
			makeTurn({
				speakerType: 'facilitator',
				speechMode: 'question',
				content:
					'戦闘が止まった瞬間、負傷者を病院に運ぶことができる。では今すぐ銃声が止んだら何が変わりますか？'
			}),
			ctx
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
		// 前提・代弁を主対象外とする指示が検証フェーズに渡っている
		expect(phase1Prompt()).toContain('問いかけの前提');
	});

	it('仮定・条件として述べた事実主張は指摘されない（国連や赤十字が見るとして）', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(phase2Result([]));
		const result = await checkTurn(
			makeTurn({
				speechMode: 'question',
				content: '国連や赤十字が見るとして、その記録は中立に保たれるのでしょうか。'
			}),
			ctx
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
		expect(phase1Prompt()).toContain('仮定');
	});

	it('質問文中でも確定事実として述べた主張は検証され、誤りなら incorrect', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(
			phase2Result([
				{
					claim: '2014年にクリミアが併合された',
					verdict: 'incorrect',
					correction: '正しくは別の経緯',
					reason: '事実と異なる',
					sourceIndices: [1]
				}
			])
		);
		const result = await checkTurn(
			makeTurn({
				speechMode: 'question',
				content: '2014年にクリミアが併合されたが、では国際法上どう評価すべきか？'
			}),
			ctx
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(1);
			expect(result.value[0].verdict).toBe('incorrect');
			expect(result.value[0].claim).toBe('2014年にクリミアが併合された');
		}
		expect(phase1Prompt()).toContain('質問文中でも');
	});

	it('制度変更を伴う断定は最新事実で誤りと判定される（W杯の試合数）', async () => {
		setResolvedSources([{ title: 'https://fifa.com', url: 'https://fifa.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(
			phase2Result([
				{
					claim: '優勝するには7試合に勝つ必要がある',
					verdict: 'incorrect',
					correction: '新方式では8試合に勝つ必要がある',
					reason: '大会方式の変更',
					sourceIndices: [1]
				}
			])
		);
		const result = await checkTurn(
			makeTurn({ content: 'ワールドカップで優勝するには7試合に勝つ必要がある。' }),
			ctx
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value[0].verdict).toBe('incorrect');
			expect(result.value[0].correction).toContain('8試合');
		}
		expect(phase1Prompt()).toContain('最新の事実');
	});

	it('時間軸の断定は与えられた現在日時を基準に検証される', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(
			phase2Result([
				{
					claim: '開催まではまだ1年以上ある',
					verdict: 'incorrect',
					correction: '本日時点で半年を切っている',
					reason: '本日を基準に誤り',
					sourceIndices: [1]
				}
			])
		);
		const result = await checkTurn(makeTurn({ content: '開催まではまだ1年以上ある。' }), ctx);
		expect(phase1Prompt()).toContain('2026年6月25日');
		expect(phase1Prompt()).toContain('時間軸');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value[0].verdict).toBe('incorrect');
	});

	it('質問モードの発言でも断定された誤りは incorrect として検出される', async () => {
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
		const result = await checkTurn(makeTurn({ speechMode: 'question' }), ctx);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value[0].verdict).toBe('incorrect');
	});

	it('（回帰）質問モードでも出典0件の主張は unverifiable に降格する', async () => {
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
		const result = await checkTurn(makeTurn({ speechMode: 'question' }), ctx);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value[0].verdict).toBe('unverifiable');
			expect(result.value[0].sources).toEqual([]);
		}
	});

	it('（回帰）引用が発言本文の部分文字列でない finding は破棄する', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		mockGenerateObject.mockResolvedValueOnce(
			phase2Result([
				{
					claim: '発言に存在しない捏造引用',
					verdict: 'incorrect',
					correction: 'x',
					reason: 'y',
					sourceIndices: [1]
				}
			])
		);
		const result = await checkTurn(makeTurn(), ctx);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});
});
