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

// 既定はパススルー（kept = 入力 findings）。フィルタを検証するテストだけ上書きする。
const { mockJudge } = vi.hoisted(() => ({
	mockJudge: vi.fn(async (_content: string, findings: unknown[]) => ({
		kept: findings,
		judgments: []
	}))
}));

vi.mock('../../../pipeline/fact-check/fact-check-judge.js', () => ({
	judgeCorrectionWorthiness: mockJudge
}));

import type { DebateTurn } from '../../../types/turn.types.js';
import {
	checkContent,
	checkTurn,
	checkChapter
} from '../../../pipeline/fact-check/fact-check-runner.js';
import { getPipelineModel } from '../../../llm/models.js';

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

// generateObject は Phase0 断定ゲート（schema: assertedClaims）と Phase2 構造化（schema: findings）の
// 両方で呼ばれる。schema の形でディスパッチし、ゲートは既定で「発言全文を1つの断定主張」として返す
// （= task3 時点では検証フローを素通しさせ、既存挙動を保つ）。Phase2 はキュー／既定値で制御する。
let phase2Queue: unknown[];
let phase2Default: unknown;
let gateOverride: unknown;

const queuePhase2 = (obj: unknown) => phase2Queue.push(obj);
const setPhase2Default = (obj: unknown) => {
	phase2Default = obj;
};
// ゲート抽出結果を明示的に上書きする（断定主張の配列。空なら非断定のみ）
const setGateClaims = (claims: string[]) => {
	gateOverride = { object: { assertedClaims: claims.map((claim) => ({ claim })) } };
};

beforeEach(() => {
	vi.clearAllMocks();
	mockGetGoogleProvider.mockReturnValue(mockGoogleProvider);
	mockGoogleProvider.mockReturnValue('mock-google-model');
	mockExtractSources.mockReturnValue([{ query: 'q', summary: 's', results: [] }]);
	mockResolveSourceUrls.mockResolvedValue([{ query: 'q', summary: 's', results: [] }]);
	mockGetTopicById.mockResolvedValue({ id: 't1', title: 'ウクライナ情勢と医療' });
	mockJudge.mockImplementation(async (_content: string, findings: unknown[]) => ({
		kept: findings,
		judgments: []
	}));
	phase2Queue = [];
	phase2Default = phase2Result([]);
	gateOverride = null;
	mockGenerateObject.mockImplementation(
		async (args: { schema: { shape: object }; messages: Array<{ content: string }> }) => {
			const isGate = Object.keys(args.schema.shape).includes('assertedClaims');
			if (isGate) {
				if (gateOverride) return gateOverride;
				// 既定: プロンプト末尾の【対象の発言】以降を全文1主張として抽出（部分文字列照合を通す）
				const text = args.messages[0].content;
				const marker = '【対象の発言】\n';
				const idx = text.lastIndexOf(marker);
				const content = idx >= 0 ? text.slice(idx + marker.length) : '';
				return { object: { assertedClaims: content ? [{ claim: content }] : [] } };
			}
			return phase2Queue.length ? phase2Queue.shift() : phase2Default;
		}
	);
});

describe('checkTurn', () => {
	it('context を渡すと Phase1 プロンプトにテーマ・章の文脈を含める', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(phase2Result([]));
		await checkTurn(makeTurn(), {
			topicTitle: 'ウクライナ情勢と医療',
			chapterTitle: '戦時下の医療中立性',
			discussionScope: '医療は誰を守るのか',
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
		queuePhase2(phase2Result([]));
		await checkTurn(makeTurn(), {
			topicTitle: 'T',
			chapterTitle: 'C',
			discussionScope: 'F',
			currentDate: '2026年6月25日'
		});
		const args = mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> };
		const prompt = args.messages[0].content;
		expect(prompt).toContain('2026年6月25日');
		expect(prompt).toContain('時間軸');
	});

	it('Phase1 プロンプトは断定主張のみを反証起点で検証し、問い/前提/仮定/代弁は含まれない旨を明記する', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(phase2Result([]));
		await checkTurn(makeTurn());
		const prompt = (mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> })
			.messages[0].content;
		expect(prompt).toContain('検証対象の断定主張');
		expect(prompt).toContain('事実として断定された主張');
		expect(prompt).toContain('反証起点');
		expect(prompt).toContain('代弁');
		expect(prompt).toContain('最新の事実');
	});

	it('speechMode が question のとき Phase1 プロンプトに問いかけの手掛かりを付すが一律除外しない旨を明記する', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(phase2Result([]));
		await checkTurn(makeTurn({ speechMode: 'question' }));
		const prompt = (mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> })
			.messages[0].content;
		expect(prompt).toContain('質問モードのシグナル');
		expect(prompt).toContain('一律に検証対象外としない');
	});

	it('speechMode が question 以外のとき質問モードの手掛かりは付さない', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(phase2Result([]));
		await checkTurn(makeTurn({ speechMode: 'fact' }));
		const prompt = (mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> })
			.messages[0].content;
		expect(prompt).not.toContain('質問モードのシグナル');
	});

	it('Phase2 プロンプトは断定主張前提のバックストップ（二次的安全網）として整理され、構造化の出力ルールは不変', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(phase2Result([]));
		await checkTurn(makeTurn());
		// generateObject の1回目は Phase0 断定ゲート、2回目が Phase2 構造化
		const prompt = (mockGenerateObject.mock.calls[1][0] as { messages: Array<{ content: string }> })
			.messages[0].content;
		// 断定主張に絞り込み済みである前提と、非断定抑制が二次的安全網に格下げされていること
		expect(prompt).toContain('断定された主張');
		expect(prompt).toContain('二次的な安全網');
		expect(prompt).toContain('finding を生成しない');
		expect(prompt).toContain('不確実');
		// 構造化の出力ルール（指摘の形・verdict 値）は不変
		expect(prompt).toContain('部分文字列');
		expect(prompt).toContain('incorrect');
		expect(prompt).toContain('unverifiable');
		expect(prompt).toContain('sourceIndices');
	});

	it('断定された誤りには誤り箇所・正しい事実・理由・出典を伴う指摘が従来どおり生成される（形・verdict 不変）', async () => {
		setResolvedSources([{ title: 'FIFA 公式', url: 'https://fifa.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(
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
			expect(result.value).toHaveLength(1);
			const f = result.value[0];
			expect(f.claim).toBe('日本の人口は2億人である');
			expect(f.verdict).toBe('incorrect');
			expect(f.correction).toBe('約1.2億人');
			expect(f.reason).toBe('統計と矛盾');
			expect(f.sources).toEqual([{ title: 'FIFA 公式', url: 'https://fifa.com' }]);
		}
	});

	it('Phase1 を google_search ツール付きで呼ぶ', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(phase2Result([]));
		await checkTurn(makeTurn());
		const args = mockGenerateText.mock.calls[0][0] as { tools?: Record<string, unknown> };
		expect(args.tools?.['google_search']).toBeDefined();
	});

	it('turnId と speakerType を runner が付与する（LLM 出力に依存しない）', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(
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
		queuePhase2(
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
		queuePhase2(
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
		queuePhase2(
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
		queuePhase2(phase2Result([]));
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

describe('checkContent（content ベース検証コア）', () => {
	it('検出した finding の turnId は空（束縛は呼び出し元の責務）', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(
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
		const result = await checkContent({
			content: '日本の人口は2億人である。',
			speakerType: 'persona'
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(1);
			expect(result.value[0].turnId).toBe('');
			expect(result.value[0].speakerType).toBe('persona');
		}
	});

	it('speakerType は入力で受け取り finding に反映する', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(
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
		const result = await checkContent({
			content: '日本の人口は2億人である。',
			speakerType: 'facilitator'
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value[0].speakerType).toBe('facilitator');
	});

	it('断定主張がない本文は grounding を起動せず指摘ゼロで即時通過する（7.1）', async () => {
		setGateClaims([]);
		const result = await checkContent({
			content: '本当にそれでいいのでしょうか？',
			speechMode: 'question',
			speakerType: 'persona'
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(mockGenerateObject).toHaveBeenCalledTimes(1); // ゲートのみ
	});

	it('プロバイダ利用不可なら AI_API_ERROR を返す', async () => {
		mockGetGoogleProvider.mockReturnValueOnce(null);
		const result = await checkContent({ content: 'x', speakerType: 'persona' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe('AI_API_ERROR');
	});
});

describe('checkTurn Phase0 断定ゲート', () => {
	const gatePrompt = () =>
		(mockGenerateObject.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0]
			.content;

	it('Phase1 grounding より先に断定ゲート（factCheckAssertionGate・grounding なし schema）を呼ぶ', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(phase2Result([]));
		await checkTurn(makeTurn());
		// 1回目の generateObject は assertedClaims スキーマ（断定ゲート）
		const gateArgs = mockGenerateObject.mock.calls[0][0] as { schema: { shape: object } };
		expect(Object.keys(gateArgs.schema.shape)).toContain('assertedClaims');
		expect(getPipelineModel).toHaveBeenCalledWith('factCheckAssertionGate');
		// ゲートは Phase1（grounding）より前に呼ばれる
		expect(mockGenerateObject.mock.invocationCallOrder[0]).toBeLessThan(
			mockGenerateText.mock.invocationCallOrder[0]
		);
	});

	it('ゲートのプロンプトに抽出基準（問い/前提/仮定/代弁・loaded question は抽出しない・質問内の確定事実は抽出・不確実なら断定・部分文字列引用）を含める', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(phase2Result([]));
		await checkTurn(makeTurn());
		const prompt = gatePrompt();
		expect(prompt).toContain('断定された、検証すべき事実主張');
		expect(prompt).toContain('問いかけの前提');
		expect(prompt).toContain('仮定');
		expect(prompt).toContain('代弁');
		expect(prompt).toContain('loaded question');
		expect(prompt).toContain('質問形式の発言でも');
		expect(prompt).toContain('不確実');
		expect(prompt).toContain('部分文字列');
	});

	it('speechMode が question のときゲートプロンプトに問いかけの手掛かりを付すが一律除外しない旨を明記する', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(phase2Result([]));
		await checkTurn(makeTurn({ speechMode: 'question' }));
		const prompt = gatePrompt();
		expect(prompt).toContain('質問モードのシグナル');
		expect(prompt).toContain('一律に抽出対象外としない');
	});

	it('speechMode が question 以外のときゲートプロンプトに質問モードの手掛かりを付さない', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(phase2Result([]));
		await checkTurn(makeTurn({ speechMode: 'fact' }));
		expect(gatePrompt()).not.toContain('質問モードのシグナル');
	});

	it('ゲート抽出は発言本文の部分文字列に限定され、部分文字列でない抽出は破棄される', async () => {
		const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(phase2Result([]));
		// ゲートが発言に存在しない主張のみを返す → 部分文字列照合で全破棄 → 断定ゼロ扱い
		setGateClaims(['発言本文に存在しない捏造主張']);
		await checkTurn(makeTurn({ id: 'tg', content: '日本の人口は2億人である。' }));
		expect(infoSpy).toHaveBeenCalledWith('[factCheckGate] no asserted claim', { turnId: 'tg' });
		infoSpy.mockRestore();
	});

	it('ゲートが部分文字列の断定主張を返すときは断定ゼロのログを出さない', async () => {
		const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(phase2Result([]));
		setGateClaims(['日本の人口は2億人である']);
		await checkTurn(makeTurn({ content: '日本の人口は2億人である。' }));
		expect(infoSpy).not.toHaveBeenCalledWith(
			'[factCheckGate] no asserted claim',
			expect.anything()
		);
		infoSpy.mockRestore();
	});

	it('断定主張ゼロの発言は grounding 検索・構造化を実行せず空配列を返す', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		// ゲートが断定主張なしと判定（純粋な問い・意見のみ）
		setGateClaims([]);
		const result = await checkTurn(
			makeTurn({ speechMode: 'question', content: '本当にそれでいいのでしょうか？' })
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
		// Phase1（grounding）も Phase2（構造化）も呼ばれない
		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(mockGenerateObject).toHaveBeenCalledTimes(1); // ゲートのみ
	});

	it('断定ゲートが失敗したら全文を検索検証にフォールバックし、エラーをログする（フェイルオープン）', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(
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
		// ゲート（generateObject の1回目）をスキーマ不整合で失敗させる
		mockGenerateObject.mockImplementationOnce(async () => {
			throw new Error('gate schema mismatch');
		});
		const result = await checkTurn(makeTurn());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(1);
			expect(result.value[0].verdict).toBe('incorrect');
		}
		// 全文が Phase1（grounding）に回り従来挙動になる
		expect(mockGenerateText).toHaveBeenCalledTimes(1);
		const phase1 = (mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> })
			.messages[0].content;
		expect(phase1).toContain('日本の人口は2億人である');
		// 失敗がログされる
		expect(errSpy).toHaveBeenCalledWith(
			'[checkContent] assertion gate failed; falling back to full verification',
			{ turnId: 'turn1' },
			expect.anything()
		);
		errSpy.mockRestore();
	});

	it('断定主張ゼロの発言は修正適否ジャッジも起動しない', async () => {
		setGateClaims([]);
		const result = await checkTurn(makeTurn({ content: '意見にすぎない話です' }), {
			topicTitle: 'T',
			chapterTitle: 'C',
			discussionScope: 'F',
			currentDate: '2026年6月25日'
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
		expect(mockJudge).not.toHaveBeenCalled();
	});
});

describe('checkTurn 修正適否フィルタ（共通フィルタ）', () => {
	const ctx = {
		topicTitle: 'ウクライナ情勢と医療',
		chapterTitle: '戦時下の医療中立性',
		discussionScope: '医療は誰を守るのか',
		currentDate: '2026年6月25日'
	};
	const oneFinding = () =>
		phase2Result([
			{
				claim: '日本の人口は2億人である',
				verdict: 'incorrect',
				correction: '約1.2億人',
				reason: '統計と矛盾',
				sourceIndices: [1]
			}
		]);

	it('finding を修正適否ジャッジに通し、kept のみを返す', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(oneFinding());
		// ジャッジが修正対象外（skip）と判断し空を返す
		mockJudge.mockResolvedValueOnce({ kept: [], judgments: [] });
		const result = await checkTurn(makeTurn(), ctx);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
		expect(mockJudge).toHaveBeenCalledTimes(1);
	});

	it('ジャッジには発言本文・finding・文脈を渡す', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(oneFinding());
		await checkTurn(makeTurn({ content: '日本の人口は2億人である。' }), ctx);
		const [content, findings, passedCtx] = mockJudge.mock.calls[0];
		expect(content).toBe('日本の人口は2億人である。');
		expect(findings).toHaveLength(1);
		expect(passedCtx).toEqual(ctx);
	});

	it('finding が0件のときはジャッジを呼ばない', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(phase2Result([]));
		const result = await checkTurn(makeTurn(), ctx);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
		expect(mockJudge).not.toHaveBeenCalled();
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
			discussionPoints: [],
			turns: [
				makeTurn({ id: 'tp', speakerType: 'persona', content: 'ペルソナの誤り主張' }),
				makeTurn({ id: 'tf', speakerType: 'facilitator', content: 'ファシの誤り主張' })
			],
			status: 'completed'
		});
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValue(groundingResult());
		queuePhase2(
			phase2Result([
				{
					claim: 'ペルソナの誤り主張',
					verdict: 'incorrect',
					correction: 'c',
					reason: 'r',
					sourceIndices: [1]
				}
			])
		);
		queuePhase2(
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

	it('章集約はフィルタ済み（kept）findings になる', async () => {
		mockGetChapterById.mockResolvedValueOnce({
			id: 'c1',
			chapterIndex: 0,
			title: 't',
			discussionPoints: [],
			turns: [
				makeTurn({ id: 'tp', speakerType: 'persona', content: 'ペルソナの誤り主張' }),
				makeTurn({ id: 'tf', speakerType: 'facilitator', content: 'ファシの誤り主張' })
			],
			status: 'completed'
		});
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValue(groundingResult());
		queuePhase2(
			phase2Result([
				{
					claim: 'ペルソナの誤り主張',
					verdict: 'incorrect',
					correction: 'c',
					reason: 'r',
					sourceIndices: [1]
				}
			])
		);
		queuePhase2(
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
		// 1発言目（tp）は kept、2発言目（tf）はジャッジが除外（skip）
		mockJudge
			.mockImplementationOnce(async (_c: string, findings: unknown[]) => ({
				kept: findings,
				judgments: []
			}))
			.mockImplementationOnce(async () => ({ kept: [], judgments: [] }));
		const result = await checkChapter({ topicId: 't1', chapterId: 'c1' });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(1);
			expect(result.value[0].turnId).toBe('tp');
		}
	});

	it('発言ごとに onTurnFindings を呼ぶ（逐次表示）', async () => {
		mockGetChapterById.mockResolvedValueOnce({
			id: 'c1',
			chapterIndex: 0,
			title: 't',
			discussionPoints: [],
			turns: [
				makeTurn({ id: 'tp', content: 'ペルソナの誤り主張' }),
				makeTurn({ id: 'tf', speakerType: 'facilitator', content: 'ファシの誤り主張' })
			],
			status: 'completed'
		});
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValue(groundingResult());
		queuePhase2(
			phase2Result([
				{
					claim: 'ペルソナの誤り主張',
					verdict: 'incorrect',
					correction: 'c',
					reason: 'r',
					sourceIndices: [1]
				}
			])
		);
		queuePhase2(
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
			discussionPoints: [],
			turns: [makeTurn({ id: 'tp' })],
			status: 'completed'
		});
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValue(groundingResult());
		setPhase2Default(phase2Result([]));
		const onTurn = vi.fn().mockResolvedValue(undefined);
		await checkChapter({ topicId: 't1', chapterId: 'c1' }, onTurn);
		expect(onTurn).not.toHaveBeenCalled();
	});

	it('テーマ・章の文脈を検証プロンプトに渡す（単独発言で文脈が失われない）', async () => {
		mockGetChapterById.mockResolvedValueOnce({
			id: 'c1',
			chapterIndex: 0,
			title: '戦時下の医療中立性',
			discussionPoints: [],
			turns: [makeTurn({ id: 'tp', content: '名簿を出せと言われたら拒む' })],
			status: 'completed'
		});
		mockGetTopicById.mockResolvedValueOnce({ id: 't1', title: 'ウクライナ情勢と医療' });
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValue(groundingResult());
		setPhase2Default(phase2Result([]));
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
			discussionPoints: [],
			turns: [makeTurn({ id: 'tp', content: '名簿を出せと言われたら拒む' })],
			status: 'completed'
		});
		mockGetTopicById.mockResolvedValueOnce({ id: 't1', title: 'ウクライナ情勢と医療' });
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValue(groundingResult());
		setPhase2Default(phase2Result([]));
		await checkChapter({ topicId: 't1', chapterId: 'c1' });
		const prompt = (mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> })
			.messages[0].content;
		expect(prompt).toContain('2026年6月25日');
	});
});

describe('checkChapter インライン検証済みターンの再グラウンディング回避（要件5）', () => {
	const embeddedFinding = (overrides: Record<string, unknown> = {}) => ({
		id: 'ef1',
		turnId: '',
		speakerType: 'persona',
		claim: '原ドラフトの誤り主張',
		verdict: 'incorrect',
		correction: '正しい事実',
		reason: '理由',
		sources: [],
		...overrides
	});

	const chapterWith = (turns: unknown[]) => ({
		id: 'c1',
		chapterIndex: 0,
		title: 't',
		discussionPoints: [],
		turns,
		status: 'completed'
	});

	it('補正済み（checked / revised:true）ターンは grounding を呼ばず、埋め込み指摘を結果へ流さない', async () => {
		mockGetChapterById.mockResolvedValueOnce(
			chapterWith([
				makeTurn({
					id: 'tr',
					content: '補正後の本文',
					factCheck: {
						status: 'checked',
						revised: true,
						findings: [embeddedFinding()],
						originalContent: '原ドラフトの誤り主張'
					}
				})
			])
		);
		const onTurn = vi.fn().mockResolvedValue(undefined);
		const result = await checkChapter({ topicId: 't1', chapterId: 'c1' }, onTurn);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(onTurn).not.toHaveBeenCalled();
	});

	it('補正なし指摘あり（checked / revised:false / findings）ターンは grounding を呼ばず、turnId を復元して結果へ反映する', async () => {
		mockGetChapterById.mockResolvedValueOnce(
			chapterWith([
				makeTurn({
					id: 'tre',
					content: '原ドラフトの誤り主張',
					factCheck: {
						status: 'checked',
						revised: false,
						findings: [embeddedFinding()]
					}
				})
			])
		);
		const onTurn = vi.fn().mockResolvedValue(undefined);
		const result = await checkChapter({ topicId: 't1', chapterId: 'c1' }, onTurn);
		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(1);
			expect(result.value[0].turnId).toBe('tre');
			expect(result.value[0].claim).toBe('原ドラフトの誤り主張');
		}
		expect(onTurn).toHaveBeenCalledTimes(1);
		expect(onTurn.mock.calls[0][0][0].turnId).toBe('tre');
	});

	it('検証済み指摘なし（checked / findings:[]）ターンは grounding を呼ばず反映対象なし', async () => {
		mockGetChapterById.mockResolvedValueOnce(
			chapterWith([
				makeTurn({
					id: 'tc',
					factCheck: { status: 'checked', revised: false, findings: [] }
				})
			])
		);
		const onTurn = vi.fn().mockResolvedValue(undefined);
		const result = await checkChapter({ topicId: 't1', chapterId: 'c1' }, onTurn);
		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
		expect(onTurn).not.toHaveBeenCalled();
	});

	it('未検証（unverified）ターンは従来どおり grounding で検証する', async () => {
		mockGetChapterById.mockResolvedValueOnce(
			chapterWith([
				makeTurn({
					id: 'tu',
					content: '日本の人口は2億人である。',
					factCheck: { status: 'unverified', revised: false, findings: [] }
				})
			])
		);
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValue(groundingResult());
		queuePhase2(
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
		const result = await checkChapter({ topicId: 't1', chapterId: 'c1' });
		expect(mockGenerateText).toHaveBeenCalledTimes(1);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(1);
			expect(result.value[0].turnId).toBe('tu');
		}
	});

	it('トレース無し（旧データ）ターンは従来どおり grounding で検証する', async () => {
		mockGetChapterById.mockResolvedValueOnce(
			chapterWith([makeTurn({ id: 'told', content: '日本の人口は2億人である。' })])
		);
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValue(groundingResult());
		queuePhase2(phase2Result([]));
		await checkChapter({ topicId: 't1', chapterId: 'c1' });
		expect(mockGenerateText).toHaveBeenCalledTimes(1);
	});

	it('混在章では未検証ターンのみ grounding し、補正済みターンは再検証しない', async () => {
		mockGetChapterById.mockResolvedValueOnce(
			chapterWith([
				makeTurn({
					id: 'trevised',
					content: '補正後',
					factCheck: {
						status: 'checked',
						revised: true,
						findings: [embeddedFinding()],
						originalContent: '原'
					}
				}),
				makeTurn({
					id: 'tneedscheck',
					content: '日本の人口は2億人である。',
					factCheck: { status: 'unverified', revised: false, findings: [] }
				})
			])
		);
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValue(groundingResult());
		queuePhase2(
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
		const result = await checkChapter({ topicId: 't1', chapterId: 'c1' });
		// grounding は未検証ターン1件のみ
		expect(mockGenerateText).toHaveBeenCalledTimes(1);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(1);
			expect(result.value[0].turnId).toBe('tneedscheck');
		}
	});
});

describe('checkTurn 判定妥当性（シナリオ）', () => {
	const ctx = {
		topicTitle: 'ウクライナ情勢と医療',
		chapterTitle: '戦時下の医療中立性',
		discussionScope: '医療は誰を守るのか',
		currentDate: '2026年6月25日'
	};
	const phase1Prompt = () =>
		(mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0]
			.content;

	it('Phase1 はゲート抽出の断定主張のみを検証対象にし、前提・問いの文言を渡さない（混在発言）', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(phase2Result([]));
		// 混在発言: 確定事実（断定）＋ 問い。ゲートは断定主張のみを抽出する
		setGateClaims(['2014年にクリミアが併合された']);
		await checkTurn(
			makeTurn({
				speechMode: 'question',
				content: '2014年にクリミアが併合されたが、では平和はもう近いと考えてよいのでしょうか。'
			}),
			ctx
		);
		const prompt = phase1Prompt();
		expect(prompt).toContain('検証対象の断定主張');
		expect(prompt).toContain('2014年にクリミアが併合された');
		// 問い・前提の文言は検索検証に渡らない
		expect(prompt).not.toContain('平和はもう近いと考えてよいのでしょうか');
	});

	it('問いかけの前提として述べた事実主張はゲートが抽出せず、grounding 検証も指摘も行われない（停戦の前提）', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		// 断定ゲートが問いかけの前提を断定主張として抽出しない
		setGateClaims([]);
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
		// grounding（Phase1）が呼ばれない
		expect(mockGenerateText).not.toHaveBeenCalled();
	});

	it('仮定・条件として述べた事実主張はゲートが抽出せず、grounding 検証も指摘も行われない（国連や赤十字が見るとして）', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		setGateClaims([]);
		const result = await checkTurn(
			makeTurn({
				speechMode: 'question',
				content: '国連や赤十字が見るとして、その記録は中立に保たれるのでしょうか。'
			}),
			ctx
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
		expect(mockGenerateText).not.toHaveBeenCalled();
	});

	it('問いの中の偽の前提（loaded question）はゲートが抽出せず、grounding 検証も指摘も行われない', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		setGateClaims([]);
		const result = await checkTurn(
			makeTurn({
				speechMode: 'question',
				content: 'FSBがすべての医療記録を処罰の材料に使うとして、現場はどう備えるべきでしょうか。'
			}),
			ctx
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
		expect(mockGenerateText).not.toHaveBeenCalled();
	});

	it('質問文中でも確定事実として述べた主張は検証され、誤りなら incorrect', async () => {
		setResolvedSources([{ title: 'https://a.com', url: 'https://a.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		// ゲートが質問文中の確定事実のみを抽出
		setGateClaims(['2014年にクリミアが併合された']);
		queuePhase2(
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
		// 抽出された確定事実が検証対象として Phase1 に渡る
		expect(phase1Prompt()).toContain('2014年にクリミアが併合された');
	});

	it('制度変更を伴う断定は最新事実で誤りと判定される（W杯の試合数）', async () => {
		setResolvedSources([{ title: 'https://fifa.com', url: 'https://fifa.com' }]);
		mockGenerateText.mockResolvedValueOnce(groundingResult());
		queuePhase2(
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
		queuePhase2(
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
		queuePhase2(
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
		queuePhase2(
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
		queuePhase2(
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
