/**
 * 修正適否ジャッジの「実 LLM 評価」ハーネス（任意実行・CI では走らない）。
 *
 * 通常の単体テスト（fact-check-judge.test.ts）は LLM をモックするため、プロンプト自体が
 * 過検出（問いの前提・当為/提案）を本当に skip できるかは検証できない。本ファイルは実際の
 * Gemini を呼び、評価フィクスチャに対する判定が期待どおりかを確認する。
 *
 * 実行方法:
 *   GEMINI_API_KEY=xxx pnpm --prefix functions eval:judge
 * （RUN_JUDGE_EVAL=1 は eval:judge スクリプトが付与する）
 *
 * GEMINI_API_KEY か RUN_JUDGE_EVAL が無ければ describe ごとスキップする。
 * 実モデルは非決定的なため、失敗は「そのケースでプロンプトが期待分類を外した」シグナルとして読む。
 */
import { describe, it, expect } from 'vitest';
import { judgeCorrectionWorthiness } from '../../../pipeline/fact-check/fact-check-judge.js';
import type { FactCheckFinding, FactCheckContext } from '../../../types/fact-check.types.js';

const ENABLED = process.env.RUN_JUDGE_EVAL === '1' && !!process.env.GEMINI_API_KEY;

const context: FactCheckContext = {
	topicTitle: 'ウクライナ停戦と人道回廊',
	chapterTitle: '誰が停戦監視・通行保証を担えるか',
	focusQuestion: '停戦監視の担い手と合意文書に書くべき条項',
	currentDate: '2026年6月26日'
};

// 質問ターン（問いの前提）。発言全体は問いかけ。
const questionTurn =
	'現場で一番気になるのは、誰なら最低限通行保証を信用されるのかです。国連や赤十字だけで足りるのか、インドやブラジルのような直接当事者でない国が監視に入る余地はありますか、エレナさん。';

// 提案ターン（当為・提案・規範）。合意文書に書くべき条項の提案。
const proposalTurn =
	'引き受けると言っても、インドが行方不明者捜索や証言者保護を単独で背負えるわけではないと思います。できるのは、国連任務の中で名簿照合、監視要員、違反報告を担うことです。さっきオレクサンドルさんが言っていた通り、止められた時の代償、例えば24時間以内の安保理報告や責任者への制裁まで事前に書かないと弱いです。';

// 'skip' = 過検出として除外されるべき（厳密）。
// 'keep' = 断定された主張なので残るべき（correct でも uncertain でも可。skip でなければ合格）。
type EvalCase = {
	label: string;
	content: string;
	claim: string;
	expected: 'skip' | 'keep';
};

const cases: EvalCase[] = [
	// --- 過検出抑制: skip であるべき ---
	{
		label: '問いの前提1',
		content: questionTurn,
		claim: '国連や赤十字だけで足りるのか',
		expected: 'skip'
	},
	{
		label: '問いの前提2',
		content: questionTurn,
		claim: 'インドやブラジルのような直接当事者でない国が監視に入る余地はありますか',
		expected: 'skip'
	},
	{
		label: '提案1（役割スコープ）',
		content: proposalTurn,
		claim: 'できるのは、国連任務の中で名簿照合、監視要員、違反報告を担うことです',
		expected: 'skip'
	},
	{
		label: '提案2（条項）',
		content: proposalTurn,
		claim: '24時間以内の安保理報告',
		expected: 'skip'
	},
	{
		label: '当為3（制裁の事前明記）',
		content: proposalTurn,
		claim: '責任者への制裁まで事前に書かないと弱いです',
		expected: 'skip'
	},
	// --- 回帰: 断定された主張は残る（skip されない）べき ---
	{
		label: '断定誤り（試合数）',
		content: 'ワールドカップって、今大会から試合数が64試合に増えたんですよね。',
		claim: '今大会から試合数が64試合に増えた',
		expected: 'keep'
	},
	{
		label: '断定（時間軸）',
		content: '開催まではまだ1年以上ありますよ。慌てる必要はないと思います。',
		claim: '開催まではまだ1年以上ある',
		expected: 'keep'
	}
];

const finding = (claim: string): FactCheckFinding => ({
	id: 'eval-1',
	turnId: 't1',
	speakerType: 'persona',
	claim,
	verdict: 'incorrect',
	correction: '（評価用ダミー）',
	reason: '（評価用ダミー）',
	sources: []
});

describe.skipIf(!ENABLED)('修正適否ジャッジ 実LLM評価', () => {
	it.each(cases)(
		'$label → 期待 $expected',
		async ({ content, claim, expected }) => {
			const result = await judgeCorrectionWorthiness(content, [finding(claim)], context);
			const judgment = result.judgments[0];
			// 実モデルの判定と理由を可視化（プロンプト調整の手掛かり）
			console.info(`[eval] "${claim.slice(0, 30)}..." → ${judgment.decision} : ${judgment.reason}`);
			// skip ケースは厳密に skip、keep ケースは「skip でなければ合格」（correct/uncertain いずれも残る）
			if (expected === 'skip') {
				expect(judgment.decision).toBe('skip');
				expect(result.kept).toHaveLength(0);
			} else {
				expect(judgment.decision).not.toBe('skip');
				expect(result.kept).toHaveLength(1);
			}
		},
		60_000
	);
});
