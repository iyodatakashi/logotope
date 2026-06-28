import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGenerateObject } = vi.hoisted(() => ({ mockGenerateObject: vi.fn() }));

vi.mock('ai', () => ({ generateObject: mockGenerateObject }));

const { mockGetPipelineModel } = vi.hoisted(() => ({
	mockGetPipelineModel: vi.fn(() => 'mock-judge-model')
}));
vi.mock('../../../llm/models.js', () => ({ getPipelineModel: mockGetPipelineModel }));

import { judgeCorrectionWorthiness } from '../../../pipeline/fact-check/fact-check-judge.js';
import type { FactCheckFinding, FactCheckContext } from '../../../types/fact-check.types.js';

const context: FactCheckContext = {
	topicTitle: 'ウクライナ情勢と医療',
	chapterTitle: '人道回廊の通行保証',
	discussionScope: '誰が通行保証を担えるか',
	currentDate: '2026年6月26日'
};

const finding = (id: string, claim: string): FactCheckFinding => ({
	id,
	turnId: 't1',
	speakerType: 'persona',
	claim,
	verdict: 'incorrect',
	correction: '正しい事実',
	reason: '理由',
	sources: []
});

const mockJudgments = (judgments: { id: string; decision: string; reason?: string }[]) => {
	mockGenerateObject.mockResolvedValue({
		object: { judgments: judgments.map((j) => ({ reason: 'r', ...j })) }
	});
};

beforeEach(() => {
	vi.clearAllMocks();
	mockGetPipelineModel.mockReturnValue('mock-judge-model');
});

describe('judgeCorrectionWorthiness', () => {
	it('skip と判定された finding のみ除外し、correct/uncertain は残す', async () => {
		const findings = [finding('a', 'claim-a'), finding('b', 'claim-b'), finding('c', 'claim-c')];
		mockJudgments([
			{ id: 'a', decision: 'correct' },
			{ id: 'b', decision: 'skip' },
			{ id: 'c', decision: 'uncertain' }
		]);

		const result = await judgeCorrectionWorthiness('発言本文', findings, context);

		expect(result.kept.map((f) => f.id)).toEqual(['a', 'c']);
		expect(result.judgments).toHaveLength(3);
	});

	it('判定用モデルで構造化判定を1回呼ぶ', async () => {
		mockJudgments([{ id: 'a', decision: 'skip' }]);
		await judgeCorrectionWorthiness('発言本文', [finding('a', 'claim-a')], context);
		expect(mockGetPipelineModel).toHaveBeenCalledWith('factCheckJudge');
		expect(mockGenerateObject).toHaveBeenCalledTimes(1);
	});

	it('id で突合する（返却順が入力順と異なっても正しく対応づける）', async () => {
		const findings = [finding('a', 'claim-a'), finding('b', 'claim-b')];
		mockJudgments([
			{ id: 'b', decision: 'skip' },
			{ id: 'a', decision: 'correct' }
		]);

		const result = await judgeCorrectionWorthiness('発言本文', findings, context);

		expect(result.kept.map((f) => f.id)).toEqual(['a']);
	});

	it('per-finding フェイルオープン: 判定が返らなかった finding はその1件だけ unjudged で残す', async () => {
		const findings = [finding('a', 'claim-a'), finding('b', 'claim-b')];
		mockJudgments([{ id: 'a', decision: 'skip' }]); // b の判定なし

		const result = await judgeCorrectionWorthiness('発言本文', findings, context);

		expect(result.kept.map((f) => f.id)).toEqual(['b']);
		expect(result.judgments.find((j) => j.findingId === 'b')?.decision).toBe('unjudged');
	});

	it('未知 id の判定は無視する', async () => {
		const findings = [finding('a', 'claim-a')];
		mockJudgments([
			{ id: 'a', decision: 'correct' },
			{ id: 'zzz', decision: 'skip' }
		]);

		const result = await judgeCorrectionWorthiness('発言本文', findings, context);

		expect(result.kept.map((f) => f.id)).toEqual(['a']);
		expect(result.judgments).toHaveLength(1);
	});

	it('全件フェイルオープン: LLM 失敗時は全 finding を unjudged で残す', async () => {
		const findings = [finding('a', 'claim-a'), finding('b', 'claim-b')];
		mockGenerateObject.mockRejectedValue(new Error('LLM down'));

		const result = await judgeCorrectionWorthiness('発言本文', findings, context);

		expect(result.kept.map((f) => f.id)).toEqual(['a', 'b']);
		expect(result.judgments.every((j) => j.decision === 'unjudged')).toBe(true);
	});

	it('finding の内容を改変しない（kept は入力要素そのまま）', async () => {
		const findings = [finding('a', 'claim-a')];
		mockJudgments([{ id: 'a', decision: 'correct' }]);

		const result = await judgeCorrectionWorthiness('発言本文', findings, context);

		expect(result.kept[0]).toEqual(findings[0]);
	});

	it('judgments は全 finding 分（件数一致）で reason を持つ', async () => {
		const findings = [finding('a', 'claim-a'), finding('b', 'claim-b')];
		mockJudgments([
			{ id: 'a', decision: 'skip', reason: 'これは問いの前提' },
			{ id: 'b', decision: 'correct', reason: '断定された誤り' }
		]);

		const result = await judgeCorrectionWorthiness('発言本文', findings, context);

		expect(result.judgments).toHaveLength(2);
		expect(result.judgments.every((j) => typeof j.reason === 'string')).toBe(true);
	});
});

// 評価ケース（回帰）。実際の過検出例・回帰例を fixture として固定する。
// 注: LLM はモックのため、ここで指定する decision は「判定がそうあるべき」という期待値であり、
// プロンプト自体の分類品質（モデルが実際に skip を返すか）は実 LLM での手動評価で確認する（research.md）。
// 本テストは「期待 decision に対しフィルタが正しく振る舞うか」と「混在ターンの絞り込み」を回帰で守る。
// fixture の文言は評価入力としてのみ用い、判定プロンプトには持ち込まない（要件2.6）。
type EvalItem = { claim: string; decision: 'correct' | 'skip' | 'uncertain' };
type EvalCase = { name: string; items: EvalItem[]; expectedKept: string[] };

const runEval = async (items: EvalItem[]) => {
	const findings = items.map((item, i) => finding(`f${i}`, item.claim));
	mockJudgments(findings.map((f, i) => ({ id: f.id, decision: items[i].decision })));
	const result = await judgeCorrectionWorthiness('発言本文', findings, context);
	return result.kept.map((f) => f.claim);
};

describe('評価ケース（回帰）', () => {
	// 過検出抑制: 問いの前提・当為/提案は skip → kept から除外される
	const overDetection: EvalCase[] = [
		{
			name: '問いの前提1: 国連や赤十字だけで足りるのか',
			items: [{ claim: '国連や赤十字だけで足りるのか', decision: 'skip' }],
			expectedKept: []
		},
		{
			name: '問いの前提2: 直接当事者でない国が監視に入る余地はありますか',
			items: [
				{
					claim: 'インドやブラジルのような直接当事者でない国が監視に入る余地はありますか',
					decision: 'skip'
				}
			],
			expectedKept: []
		},
		{
			name: '提案1: 国連任務の中で担う役割のスコープ提案',
			items: [
				{
					claim: 'できるのは、国連任務の中で名簿照合、監視要員、違反報告を担うことです',
					decision: 'skip'
				}
			],
			expectedKept: []
		},
		{
			name: '提案2: 24時間以内の安保理報告という条項提案',
			items: [{ claim: '24時間以内の安保理報告', decision: 'skip' }],
			expectedKept: []
		},
		{
			name: '当為3: 責任者への制裁を事前に書くべき',
			items: [{ claim: '責任者への制裁まで事前に書かないと弱いです', decision: 'skip' }],
			expectedKept: []
		}
	];

	it.each(overDetection)(
		'過検出抑制: $name は kept から除外される',
		async ({ items, expectedKept }) => {
			expect(await runEval(items)).toEqual(expectedKept);
		}
	);

	// 過検出5件は uncertain に逃げず skip であることを fixture の decision として固定する（受け入れ基準）
	it('過検出5件の期待 decision は skip（uncertain 逃避の抑止）', () => {
		expect(overDetection.flatMap((c) => c.items).every((i) => i.decision === 'skip')).toBe(true);
	});

	// 回帰: 断定された誤りは correct → kept に残る
	it.each<EvalCase>([
		{
			name: '断定誤り: 大会方式変更による試合数',
			items: [{ claim: '今大会から試合数は64試合に増えた', decision: 'correct' }],
			expectedKept: ['今大会から試合数は64試合に増えた']
		},
		{
			name: '断定誤り: 時間軸の断定',
			items: [{ claim: '開催まではまだ1年以上ある', decision: 'correct' }],
			expectedKept: ['開催まではまだ1年以上ある']
		},
		{
			name: 'uncertain は残す',
			items: [{ claim: '判別が難しい主張', decision: 'uncertain' }],
			expectedKept: ['判別が難しい主張']
		}
	])('回帰: $name は kept に残る', async ({ items, expectedKept }) => {
		expect(await runEval(items)).toEqual(expectedKept);
	});

	// 混在ターン: 提案2件（skip）と断定誤り1件（correct）が同一発言にある場合、誤りのみ残す
	it('混在ターン: 提案は除外し断定誤りだけ残す', async () => {
		const kept = await runEval([
			{ claim: '24時間以内の安保理報告', decision: 'skip' },
			{ claim: '責任者への制裁まで事前に書かないと弱いです', decision: 'skip' },
			{ claim: '今大会から試合数は64試合に増えた', decision: 'correct' }
		]);
		expect(kept).toEqual(['今大会から試合数は64試合に増えた']);
	});
});
