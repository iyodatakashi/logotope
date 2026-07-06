import { generateText, generateObject } from 'ai';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getPipelineModel, getGoogleProvider } from '../../llm/models.js';
import { PIPELINE_MODELS } from '../../constants/ai.constants.js';
import {
	extractSources,
	resolveSourceUrls,
	type GroundingMetadata,
	type SearchResult
} from '../../search/grounding.js';
import { judgeCorrectionWorthiness } from './fact-check-judge.js';
import type { DebateTurn } from '../../types/turn.types.js';
import type { FactCheckFinding, FactCheckContext } from '../../types/fact-check.types.js';
import type { Result, PipelineError } from '../../types/common.types.js';

const findingSchema = z.object({
	claim: z.string(),
	verdict: z.enum(['incorrect', 'unverifiable']),
	correction: z.string(),
	reason: z.string(),
	sourceIndices: z.array(z.number())
});

const phase2Schema = z.object({ findings: z.array(findingSchema) });

// Phase0 断定ゲートの出力スキーマ（grounding なし）。
// claim は当該発言 content の部分文字列。空配列なら検証対象なし（=非断定のみ）。
const assertionGateSchema = z.object({
	assertedClaims: z.array(z.object({ claim: z.string() }))
});

/** Phase0 断定ゲート: 発言から「事実として断定された検証すべき事実主張」のみを抽出させる（grounding なし） */
const buildAssertionGatePrompt = (
	content: string,
	context?: FactCheckContext,
	speechMode?: DebateTurn['speechMode']
): string => {
	const questionNote =
		speechMode === 'question'
			? '\n- この発言には質問モードのシグナルが付いている（問いかけである手掛かり）。ただしモードのみを理由に発言内の全主張を一律に抽出対象外としない'
			: '';
	return `${buildContextSection(context)}次の発言から「事実として断定された、検証すべき事実主張」だけを抽出してください。

【抽出の基準】
- 意見・価値判断は抽出しない。事実として断定された主張のみを抽出する
- 問い・問いかけの前提・仮定/条件（「〜が見るとして」「もし〜なら」）・他者認識の代弁は抽出しない
- 問いの中で偽の前提として埋め込まれた主張（loaded question）も抽出しない
- ただし質問形式の発言でも、その中で確定した事実（過去に起きた出来事・既成の状態）として述べた部分は抽出する
- 話者がペルソナでもファシリテーターでも同一基準で扱う
- 断定か非断定かが不確実なときは、断定として抽出する（見逃しを避ける保守的デフォルト）${questionNote}
- 各 claim は対象の発言からの正確な引用（部分文字列）にする

【対象の発言】
${content}`;
};

const buildContextSection = (context?: FactCheckContext): string => {
	if (!context) return '';
	const scope = context.discussionScope ? `（${context.discussionScope}）` : '';
	return `【討論のテーマ】${context.topicTitle}
【この章で議論していること】${context.chapterTitle}${scope}
【本日】${context.currentDate}

この発言は上記テーマの討論の一部です。一般論ではなく、このテーマ・状況に即して事実性を検証してください。
時間軸に関する主張（出来事までの残り期間・開催時期など）は、本日（${context.currentDate}）を基準に正否を検証してください。

`;
};

const buildPhase1Prompt = (
	assertedClaims: string[],
	context?: FactCheckContext,
	speechMode?: DebateTurn['speechMode']
): string => {
	const questionNote =
		speechMode === 'question'
			? '\n- この発言には質問モードのシグナルが付いている（問いかけである手掛かり）。ただしモードのみを理由に発言内の全主張を一律に検証対象外としない'
			: '';
	const claimList = assertedClaims.map((claim) => `- ${claim}`).join('\n');
	return `${buildContextSection(context)}次の「検証対象の断定主張」を、誤り・実態と異なる証拠を優先的に探して検証してください（反証起点）。これらは発言から事実として断定された主張だけを抽出したものです。問い・問いかけの前提・仮定/条件（「〜が見るとして」「もし〜なら」）・他者認識の代弁の文言は含まれていません。

【検証の姿勢】
- 各断定主張について、誤っている証拠を優先的に検索し、正しい事実・理由を確認する
- 制度・規則の変更を伴う事実（大会方式の変更による試合数など）は最新の事実に照らして確認する
- 当事者の証言・統計・公式情報を根拠にする${questionNote}

【検証対象の断定主張】
${claimList}

検索結果を踏まえ、各断定主張について「引用（主張そのもの）・誤っている箇所・正しい事実・理由」を記述してください。
※本文中にURL（http/https）を一切記載しないこと。出典は媒体名・調査機関名で示すこと。参照元リンクはシステムが検索情報から自動収集します。`;
};

const buildPhase2Prompt = (
	content: string,
	verificationText: string,
	numberedSources: SearchResult[],
	context?: FactCheckContext
): string => {
	const sourceList = numberedSources.length
		? numberedSources.map((source, i) => `${i + 1}. ${source.url}`).join('\n')
		: '（出典なし）';
	return `${buildContextSection(context)}以下の検証レポートは、発言から「事実として断定された主張」だけを抽出して検証した結果です。検証レポート・出典リストをもとに、事実誤認の指摘を構造化してください。

【対象の発言】
${content}

【検証レポート】
${verificationText}

【出典リスト（番号付き）】
${sourceList}

【出力ルール】
- 入力は既に断定された事実主張に絞り込まれている。原則としてその主張の誤りを指摘する
- （二次的な安全網）万一レポートに問い・問いかけの前提・仮定/条件・他者認識の代弁など非断定の言及が紛れていた場合は、断定でないと判断し finding を生成しない。断定か非断定かが不確実なときは断定として扱い finding を生成する
- 「意見・価値判断（対象外）」と「断定でない事実言及」は別概念として扱う
- 事実上の誤りがない主張は finding を生成しない
- claim は対象の発言からの正確な引用（部分文字列）にする
- verdict は incorrect（事実と異なる）または unverifiable（裏付けが得られない）
- correction は正しい事実（unverifiable のときは空でよい）
- reason はそう判断した理由
- sourceIndices は根拠とした出典リストの番号（1始まり）の配列。出典がなければ空配列`;
};

/**
 * 発言本文ベースの検証コア（2.1）。Phase0 断定ゲート→Phase1 grounding→Phase2 構造化→修正適否ジャッジを実行し、
 * 修正対象の指摘のみを返す。`finding.turnId` は '' で返す（束縛は呼び出し元の責務）。
 * インライン補正（ドラフト検証）から呼ばれる。
 * `logId` はログ識別用（turnId 採番前のインライン経路では persona.id・章 id などを渡す）。
 */
export const checkContent = async (
	input: {
		content: string;
		speechMode?: DebateTurn['speechMode'];
		speakerType: 'persona' | 'facilitator';
		logId?: string;
	},
	context?: FactCheckContext
): Promise<Result<FactCheckFinding[], PipelineError>> => {
	const { content, speechMode, speakerType, logId } = input;
	const google = getGoogleProvider();
	if (!google) {
		return {
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'GEMINI_API_KEY is not set', retryable: false }
		};
	}

	try {
		// Phase0 断定ゲート: 発言から断定された事実主張のみを抽出し、部分文字列照合で
		// ハルシネーション抽出を破棄する（grounding なし）。
		let assertedClaims: string[];
		try {
			const gate = await generateObject({
				model: getPipelineModel('factCheckAssertionGate'),
				schema: assertionGateSchema,
				messages: [
					{
						role: 'user',
						content: buildAssertionGatePrompt(content, context, speechMode)
					}
				]
			});
			assertedClaims = gate.object.assertedClaims
				.map((assertedClaim) => assertedClaim.claim)
				.filter((claim) => content.includes(claim));
		} catch (gateErr) {
			// 断定ゲートの失敗・スキーマ不整合は見逃し回避を優先し、全文を従来どおり検証に回す（フェイルオープン・3.6）
			console.error(
				'[checkContent] assertion gate failed; falling back to full verification',
				{ turnId: logId },
				gateErr
			);
			assertedClaims = [content];
		}
		// 非断定のみ（問い・前提・仮定・代弁）の発言は grounding 検索にも掛けず、指摘なしで終える（7.1）
		if (assertedClaims.length === 0) {
			console.info('[factCheckGate] no asserted claim', { turnId: logId });
			return { ok: true, value: [] };
		}

		const phase1 = await generateText({
			model: google(PIPELINE_MODELS.factCheckGrounding),
			tools: { google_search: google.tools.googleSearch({}) },
			messages: [{ role: 'user', content: buildPhase1Prompt(assertedClaims, context, speechMode) }]
		});

		const googleMeta = phase1.providerMetadata?.['google'] as
			| { groundingMetadata?: GroundingMetadata }
			| undefined;
		const groundingMetadata = googleMeta?.groundingMetadata;
		const rawSources = groundingMetadata
			? extractSources(groundingMetadata, phase1.text.slice(0, 500))
			: [];
		const resolved = await resolveSourceUrls(rawSources);
		const numberedSources = resolved[0]?.results ?? [];

		const phase2 = await generateObject({
			model: getPipelineModel('factCheckStructuring'),
			schema: phase2Schema,
			messages: [
				{
					role: 'user',
					content: buildPhase2Prompt(content, phase1.text, numberedSources, context)
				}
			]
		});

		const findings: FactCheckFinding[] = [];
		phase2.object.findings.forEach((finding) => {
			// claim は当該発言本文の部分文字列であることを照合（ハルシネーション引用を破棄）
			if (!content.includes(finding.claim)) return;
			const sources = finding.sourceIndices
				.map((sourceIndex) => numberedSources[sourceIndex - 1])
				.filter((source): source is SearchResult => !!source);
			// 出典が得られない主張は検証不能とする（3.4, 3.6）
			const verdict = sources.length === 0 ? 'unverifiable' : finding.verdict;
			findings.push({
				id: nanoid(),
				turnId: '', // 呼び出し元が束縛する
				speakerType,
				claim: finding.claim,
				verdict,
				correction: finding.correction,
				reason: finding.reason,
				sources
			});
		});

		// 修正適否ジャッジ（共通フィルタ）: 修正すべき finding のみ残す。
		// finding 0 件、または文脈なしのときは判定を起動せずそのまま返す（1.3）。
		if (findings.length > 0 && context) {
			const { kept } = await judgeCorrectionWorthiness(content, findings, context);
			return { ok: true, value: kept };
		}

		return { ok: true, value: findings };
	} catch (err) {
		console.error('[checkContent] error', { turnId: logId }, err);
		return {
			ok: false,
			error: {
				code: 'AI_API_ERROR',
				message: err instanceof Error ? err.message : String(err),
				retryable: true
			}
		};
	}
};
