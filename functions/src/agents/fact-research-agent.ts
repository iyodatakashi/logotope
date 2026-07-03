import { generateText, generateObject } from 'ai';
import { z } from 'zod';
import { getPipelineModel, getGoogleProvider } from '../llm/models.js';
import { PIPELINE_MODELS } from '../constants/ai.constants.js';
import {
	extractSources,
	resolveSourceUrls,
	type GroundingMetadata,
	type SearchResult
} from '../search/grounding.js';
import type { FactBase, FactItem } from '../types/topic.types.js';
import type { Result, PipelineError } from '../types/common.types.js';

const factSchema = z.object({
	statement: z.string(),
	sourceIndices: z.array(z.number())
});

const structuringSchema = z.object({ facts: z.array(factSchema) });

const formatDate = (now: Date): string =>
	`${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

// Phase1 grounding: 現在日付基準でテーマの客観的事実を収集する（google_search）。
const buildGroundingPrompt = (title: string, now: Date): string =>
	`本日は${formatDate(now)}です。次のテーマについて「実際に何が起きたか／現在の状況」を、検索で客観的事実として収集してください。

【テーマ】${title}

【収集の基準】
- 検証可能な具体的事実（出来事・結果・数値・固有名詞・日付）を集める
- 一般論・抽象的な評価ではなく、実際に確認できる事実に限定する
- 主観的な立場・信念・評価・是非の判断は含めない（客観的事実のみ）
- 本日（${formatDate(now)}）を基準に最新の状況を確認する
- テーマが時事的・具体的な出来事を含まない場合は、確たる具体的事実が無いと判断してよい（事実を捏造しない）
※本文中にURL（http/https）を一切記載しないこと。出典は媒体名・調査機関名で示すこと。参照元リンクはシステムが検索情報から自動収集します。`;

// Phase2 構造化: grounding テキストと出典リストから、出典付きの事実項目に構造化する。
const buildStructuringPrompt = (
	title: string,
	now: Date,
	groundingText: string,
	numberedSources: SearchResult[]
): string => {
	const sourceList = numberedSources.length
		? numberedSources.map((s, i) => `${i + 1}. ${s.url}`).join('\n')
		: '（出典なし）';
	return `以下は「${title}」について本日（${formatDate(now)}）基準で収集した客観的事実のレポートです。レポートと出典リストをもとに、検証可能な具体的事実を構造化してください。

【収集レポート】
${groundingText}

【出典リスト（番号付き）】
${sourceList}

【出力ルール】
- statement は検証可能な具体的事実（出来事・結果・数値・固有名詞・日付）。一般論・抽象的評価は含めない
- 主観的な立場・信念・評価は含めない（客観的事実のみ）
- 確たる事実が無ければ空配列にする（事実を捏造しない）
- sourceIndices は根拠とした出典リストの番号（1始まり）の配列。出典がなければ空配列`;
};

/**
 * トピック事実基盤を生成する（R1）。現在日付（now）を基準に grounding で客観的事実を収集し、
 * 既存の出典抽出・リダイレクト解決を経て出典付きに構造化する。grounding が事実を返さない／
 * 時事性が無い場合は捏造せず空の事実基盤（facts: []）を返す（成功扱い・R1.5/1.6）。
 */
export const runFactResearch = async (
	title: string,
	now: Date
): Promise<Result<FactBase, PipelineError>> => {
	const google = getGoogleProvider();
	if (!google) {
		return {
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'GEMINI_API_KEY is not set', retryable: false }
		};
	}

	try {
		const grounding = await generateText({
			model: google(PIPELINE_MODELS.factResearch),
			tools: { google_search: google.tools.googleSearch({}) },
			messages: [{ role: 'user', content: buildGroundingPrompt(title, now) }]
		});

		const googleMeta = grounding.providerMetadata?.['google'] as
			| { groundingMetadata?: GroundingMetadata }
			| undefined;
		const groundingMetadata = googleMeta?.groundingMetadata;
		const rawSources = groundingMetadata
			? extractSources(groundingMetadata, grounding.text.slice(0, 500))
			: [];
		const resolved = await resolveSourceUrls(rawSources);
		const numberedSources = resolved[0]?.results ?? [];

		// grounding が事実を返さない（出典0件）＝時事性なし。捏造せず空の事実基盤に縮退する（R1.5/1.6）。
		if (numberedSources.length === 0) {
			return { ok: true, value: { facts: [], generatedAt: now } };
		}

		const structuring = await generateObject({
			model: getPipelineModel('factResearch'),
			schema: structuringSchema,
			messages: [
				{
					role: 'user',
					content: buildStructuringPrompt(title, now, grounding.text, numberedSources)
				}
			]
		});

		const facts: FactItem[] = structuring.object.facts
			.filter((f) => f.statement.trim().length > 0)
			.map((f) => {
				const sources = f.sourceIndices
					.map((idx) => numberedSources[idx - 1])
					.filter((s): s is SearchResult => !!s);
				return { statement: f.statement, sources };
			});

		return { ok: true, value: { facts, generatedAt: now } };
	} catch (err) {
		console.error('[runFactResearch] error', err);
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
