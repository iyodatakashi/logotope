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
import { getChapterById } from '../debate/chapter.js';
import { getTopicById } from '../topics/topics.js';
import { judgeCorrectionWorthiness } from './fact-check-judge.js';
import { currentDateString } from '../../utils/prompt-formatters.js';
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
	const focus = context.focusQuestion ? `（${context.focusQuestion}）` : '';
	return `【討論のテーマ】${context.topicTitle}
【この章で議論していること】${context.chapterTitle}${focus}
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
		? numberedSources.map((s, i) => `${i + 1}. ${s.url}`).join('\n')
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
 * インライン補正（ドラフト検証）と後追い `checkTurn` の双方から呼ばれる単一実装。
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
				.map((c) => c.claim)
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
		phase2.object.findings.forEach((f) => {
			// claim は当該発言本文の部分文字列であることを照合（ハルシネーション引用を破棄）
			if (!content.includes(f.claim)) return;
			const sources = f.sourceIndices
				.map((idx) => numberedSources[idx - 1])
				.filter((s): s is SearchResult => !!s);
			// 出典が得られない主張は検証不能とする（3.4, 3.6）
			const verdict = sources.length === 0 ? 'unverifiable' : f.verdict;
			findings.push({
				id: nanoid(),
				turnId: '', // 呼び出し元が束縛する
				speakerType,
				claim: f.claim,
				verdict,
				correction: f.correction,
				reason: f.reason,
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

/**
 * 1つの発言を検証し指摘の配列を返す薄いラッパ（2.2）。検証コア `checkContent` を呼び、
 * 検出された finding に対象発言 ID（`turn.id`）を後付けするだけ。後追い検証の挙動を不変に保つ。
 */
export const checkTurn = async (
	turn: DebateTurn,
	context?: FactCheckContext
): Promise<Result<FactCheckFinding[], PipelineError>> => {
	const result = await checkContent(
		{
			content: turn.content,
			speechMode: turn.speechMode,
			speakerType: turn.speakerType === 'facilitator' ? 'facilitator' : 'persona',
			logId: turn.id
		},
		context
	);
	if (result.ok) {
		result.value.forEach((finding) => {
			finding.turnId = turn.id;
		});
	}
	return result;
};

/** 1発言の検証が終わるたびに、その発言の指摘を通知するコールバック（逐次表示用） */
export type OnTurnFindings = (findings: FactCheckFinding[]) => Promise<void>;

/**
 * 章全体の発言を検証し、誤り／検証不能の指摘を集約して返す（2.3）。
 * 発言は1件ずつ順次処理し（メモリのピークを抑え OOM を避ける）、各発言の指摘が確定するたびに
 * onTurnFindings を呼ぶ（逐次表示用）。
 */
export const checkChapter = async (
	input: { topicId: string; chapterId: string },
	onTurnFindings?: OnTurnFindings
): Promise<Result<FactCheckFinding[], PipelineError>> => {
	const chapter = await getChapterById(input.topicId, input.chapterId);
	if (!chapter) {
		return { ok: false, error: { code: 'NOT_FOUND', resource: 'chapter' } };
	}

	// 検索プロバイダが利用不可なら検証せず、章全体を検証不能（findings 空）として終える（3.6）
	if (!getGoogleProvider()) {
		console.warn('[checkChapter] search provider unavailable; chapter unverifiable', input);
		return { ok: true, value: [] };
	}

	// 発言を単独で検証すると一般論に流れるため、テーマ・章の文脈を各発言の検証に渡す
	const topic = await getTopicById(input.topicId);
	const context: FactCheckContext = {
		topicTitle: topic?.title ?? '',
		chapterTitle: chapter.title,
		focusQuestion: chapter.focusQuestion,
		currentDate: currentDateString()
	};

	const turns = chapter.turns.filter(
		(t) => t.speakerType === 'persona' || t.speakerType === 'facilitator'
	);

	const allFindings: FactCheckFinding[] = [];
	for (const turn of turns) {
		const trace = turn.factCheck;
		// インライン検証済み（checked）のターンは再 grounding しない（5.1）。反映は revised で分岐する
		if (trace?.status === 'checked') {
			// 補正済み（revised:true）の埋め込み指摘は補正前ドラフトに対するもので本文と一致しない。
			// 結果ドキュメント（本文に対して突合される面）へ流すと解決済みを未解決として再提示するため流さない（5.3/5.4）
			if (trace.revised) continue;
			// 補正なし（revised:false）かつ指摘あり（再生成失敗で原ドラフト登録）は本文と一致するため、
			// 対象発言 ID を復元して結果へ反映する
			if (trace.findings.length > 0) {
				const restamped = trace.findings.map((finding) => ({ ...finding, turnId: turn.id }));
				if (onTurnFindings) await onTurnFindings(restamped);
				allFindings.push(...restamped);
			}
			// checked かつ finding なし（修正対象なし）は反映対象なし
			continue;
		}

		// unverified ターン・トレースの無い旧データのターンのみ、従来どおり grounding 検証する（5.2）
		const result = await checkTurn(turn, context);
		if (!result.ok) {
			console.error('[checkChapter] turn check failed', { turnId: turn.id }, result.error);
			continue;
		}
		if (result.value.length > 0 && onTurnFindings) {
			await onTurnFindings(result.value);
		}
		allFindings.push(...result.value);
	}
	return { ok: true, value: allFindings };
};
