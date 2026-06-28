import { generateObject } from 'ai';
import { z } from 'zod';
import { getPipelineModel } from '../../llm/models.js';
import type { FactCheckFinding, FactCheckContext } from '../../types/fact-check.types.js';

// 判定の決定種別。skip のみ除外、それ以外（correct/uncertain/unjudged）は残す（保守的デフォルト）。
export type CorrectionWorthinessDecision = 'correct' | 'skip' | 'uncertain';

// finding 1件ごとの判定結果（評価・ログ用）。unjudged は失敗時の内部値。
export type FindingJudgment = {
	findingId: string;
	decision: CorrectionWorthinessDecision | 'unjudged';
	reason: string;
};

export type CorrectionWorthinessResult = {
	kept: FactCheckFinding[]; // 修正すべきと判定して残した finding（checkTurn の戻り値に使う）
	judgments: FindingJudgment[]; // 全 finding の判定（テスト・ログ用）
};

// LLM へは finding を id（既存 nanoid）付きで提示し、id をエコーさせる。
const judgmentSchema = z.object({
	judgments: z.array(
		z.object({
			id: z.string(),
			decision: z.enum(['correct', 'skip', 'uncertain']),
			reason: z.string()
		})
	)
});

const buildJudgePrompt = (
	content: string,
	findings: FactCheckFinding[],
	context: FactCheckContext
): string => {
	const scope = context.discussionScope ? `（${context.discussionScope}）` : '';
	const findingList = findings.map((f) => `- id: ${f.id}\n  該当箇所: ${f.claim}`).join('\n');
	return `【討論のテーマ】${context.topicTitle}
【この章で議論していること】${context.chapterTitle}${scope}
【本日】${context.currentDate}

これは多様な立場の人々が意見・提案・問いを交わす討論です。以下の発言に対して検出された「事実誤認の指摘」を見直し、その指摘が本当に修正に値するかを id ごとに判定してください。

【判定の基準】
- 修正対象は「事実として断定され、そのまま残すと事実誤認として読者に伝わる主張」だけです。
- correct（修正すべき）: 断定された事実が誤っている。発言が問いや提案の形式でも、その中で確定した事実（過去の出来事・既成の状態）として断定した部分が誤っていれば correct。
- skip（修正不要）: 次のいずれかに該当するもの。
  - 問いかけの前提や、問いから再構成した暗黙の命題（話者は問うているだけで断定していない）。
  - 当為・提案・規範（「〜すべき」「〜と書かないと弱い」、これから合意文書に盛り込む条項など現状はそうでない反実仮想）。
  - 提案・当為の実現可能性や妥当性への反論（事実の検証ではない）。
  - 他者の認識の代弁・主観的な意見。
  これらに該当すると判断できたら uncertain に逃げず、自信を持って skip としてください。
- uncertain（判別不能）: 「断定された事実誤認」か「問い・提案等の非対象」かが真に判別できないときだけ。判別がつくのに迷って uncertain を選ばないこと。

【対象の発言】
${content}

【見直す指摘（id 付き）】
${findingList}

各 id について decision（correct/skip/uncertain）と reason を返してください。`;
};

/**
 * 検出済み finding を討論文脈で評価し、修正すべきもの（correct/uncertain）だけを kept として残す。
 * skip のみ除外する保守的フィルタ。判定の失敗は検出の失敗と独立に扱い、フェイルオープン（温存）する。
 * - per-finding: 判定が返らなかった id・未知 id の finding は、その1件だけ unjudged として残す。
 * - 全件: LLM 呼び出し失敗・スキーマ不整合時は全 finding を unjudged として残す。
 * 例外を呼び出し側へ伝播しない。finding の内容は改変しない。
 */
export const judgeCorrectionWorthiness = async (
	content: string,
	findings: FactCheckFinding[],
	context: FactCheckContext
): Promise<CorrectionWorthinessResult> => {
	try {
		const { object } = await generateObject({
			model: getPipelineModel('factCheckJudge'),
			schema: judgmentSchema,
			messages: [{ role: 'user', content: buildJudgePrompt(content, findings, context) }]
		});

		const decisionById = new Map(object.judgments.map((j) => [j.id, j]));
		const judgments: FindingJudgment[] = findings.map((f) => {
			const judged = decisionById.get(f.id);
			// 判定が返らなかった finding は per-finding フェイルオープン（unjudged で残す）
			if (!judged)
				return { findingId: f.id, decision: 'unjudged', reason: '判定が返却されませんでした' };
			return { findingId: f.id, decision: judged.decision, reason: judged.reason };
		});

		const kept = findings.filter((f) => {
			const judgment = judgments.find((j) => j.findingId === f.id)!;
			return judgment.decision !== 'skip';
		});

		logJudgments(findings, judgments);
		return { kept, judgments };
	} catch (err) {
		// 全件フェイルオープン: 検出済み finding を失わせない
		console.error('[judgeCorrectionWorthiness] failed; keeping all findings', err);
		const judgments: FindingJudgment[] = findings.map((f) => ({
			findingId: f.id,
			decision: 'unjudged',
			reason: err instanceof Error ? err.message : String(err)
		}));
		return { kept: [...findings], judgments };
	}
};

const logJudgments = (findings: FactCheckFinding[], judgments: FindingJudgment[]): void => {
	const byId = new Map(findings.map((f) => [f.id, f]));
	for (const j of judgments) {
		if (j.decision === 'skip') {
			console.info('[factCheckJudge] skip', {
				turnId: byId.get(j.findingId)?.turnId,
				claim: byId.get(j.findingId)?.claim,
				reason: j.reason
			});
		} else if (j.decision === 'unjudged') {
			console.warn('[factCheckJudge] unjudged (kept)', {
				findingId: j.findingId,
				reason: j.reason
			});
		}
	}
};
