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
import { formatJapaneseDate } from '../utils/prompt-formatters.js';
import type { FactBase, FactItem } from '../types/factBase.types.js';
import type { Result, PipelineError } from '../types/common.types.js';

const factSchema = z.object({
	statement: z
		.string()
		.describe(
			'検証可能な具体的事実を1つ。レポートにある数値・固有名詞・日付・経緯は一般論に薄めず落とさず残した文（必要なら複数文）。無い具体は推測で補わない'
		),
	sourceIndices: z.array(z.number())
});

const structuringSchema = z.object({ facts: z.array(factSchema) });

// Phase1 grounding: 現在日付基準でテーマの客観的事実を収集する（google_search）。
// 後段(Phase2)は本レポートに書かれた事実しか構造化できない（捏造禁止）ため、ここで
// 具体を詰めた網羅的なレポートを長く書くこと自体が事実基盤の情報量の天井になる。
const buildGroundingPrompt = (title: string, description: string, now: Date): string => {
	// テーマ詳細（論点・観点）を検索の絞り込みレンズにする。詳細が無ければタイトルのみ（従来挙動）。
	const focus = description.trim()
		? `\n\n【この討論で掘り下げたい論点・観点】\n${description.trim()}\n\nこの論点にフォーカスして検索・収集する。テーマの表層キーワードに関する一般的な概況（利用率・導入率・普及状況などの統計）は、上の論点に直接関わらない限り拾わない。論点に噛み合う具体的事実（関係主体の判断・予算や投資の増減・事業や施策の動向・具体的な事例）を優先して集める。`
		: '';
	return `本日は${formatJapaneseDate(now)}です。次のテーマについて「実際に何が起きたか／現在の状況」を検索し、確認できた客観的事実を可能な限り多く・具体的に列挙した網羅レポートを作成してください。

【テーマ】${title}${focus}

【収集の基準】
- 検証可能な具体的事実（出来事・結果・数値・固有名詞・日付・経緯）を、確認できる範囲で具体的に集める
- 一般論・抽象的な評価に薄めず、数値・固有名詞・日付・経緯といった具体を落とさずに拾う
- テーマの主要な出来事・論点・関係主体を網羅するよう、複数の側面から幅広く情報を集める（多面的なテーマでは単一の側面に偏らない）
- 得られた具体的情報を恣意的に少数へ切り詰めず、確認できたものは幅広く収集する
- 主観的な立場・信念・評価・是非の判断は含めない（客観的事実のみ）
- 本日（${formatJapaneseDate(now)}）を基準に最新の状況を確認する
- テーマが時事的・具体的な出来事を含まない場合は、確たる具体的事実が無いと判断してよい（事実を捏造しない）

【レポートの書式（重要）】
- 確認できた具体的事実を「箇条書き」で、できる限り多く列挙する（目安として10件以上。事実が乏しいテーマでは無理に埋めない）
- 各項目は、確認できた数値・固有名詞・日付・経緯があれば省略せず盛り込む（得られた範囲で具体を残す。数値や日付を機械的に必須とはせず、確認できない具体を推測で補ったり埋めたりしない）。一般論の「〜が起きた」で丸めず、確認できた具体はそのまま書く
- 検索で複数回調べ、出来事の推移・関係主体それぞれの動きを幅広く拾う。要約して丸めず、得られた具体を保ったまま列挙する
※本文中にURL（http/https）を一切記載しないこと。出典は媒体名・調査機関名で示すこと。参照元リンクはシステムが検索情報から自動収集します。`;
};

// Phase2 構造化: grounding テキストと出典リストから、出典付きの事実項目に構造化する。
const buildStructuringPrompt = (
	title: string,
	description: string,
	now: Date,
	groundingText: string,
	numberedSources: SearchResult[]
): string => {
	const sourceList = numberedSources.length
		? numberedSources.map((source, i) => `${i + 1}. ${source.url}`).join('\n')
		: '（出典なし）';
	// 構造化でも同じ論点を優先軸にする（論点に関わる事実を優先し、無関係な概況を落とす）。
	const focus = description.trim()
		? `\n\n【掘り下げたい論点・観点】\n${description.trim()}\n※上の論点に関わる事実を優先して構造化する。論点に直接関わらない一般的な概況（利用率・導入率などの統計）は、論点の理解に必要でない限り含めない。`
		: '';
	return `以下は「${title}」について本日（${formatJapaneseDate(now)}）基準で収集した客観的事実のレポートです。レポートと出典リストをもとに、検証可能な具体的事実を構造化してください。${focus}

【収集レポート】
${groundingText}

【出典リスト（番号付き）】
${sourceList}

【出力ルール】
- レポートに現れる客観的事実は、要約でまとめたり恣意的に件数を絞ったりせず、検証可能な単位ごとに構造化する（複数の事実を1件へ圧縮しない）。ただし主観的な立場・評価・是非や、帰属・観測形に還元できない立場依存の主張は共有事実基盤に含めない（それらは各ペルソナの層②に委ねる。下記「立場で認識が分かれる事項の扱い」を参照）
- statement は検証可能な具体的事実（出来事・結果・数値・固有名詞・日付・経緯）。レポートに数値・固有名詞・日付・経緯があれば一般論に薄めず、得られた具体をできるだけ落とさず残す（数値や日付を機械的に必須とはせず、レポートに無い具体を推測で補わない。一般論の「〜が起きた」で丸めない）
- テーマの主要な出来事・論点・関係主体を網羅するよう複数の事実を出力し、得られた具体を恣意的に少数へ切り詰めない
- 1つの事実に無関係な複数の主張を詰め込まず、検証可能な単位で1件ずつ記述する
- 主観的な立場・信念・評価は含めない（客観的事実のみ）
- レポートの出典で裏付けられない具体（数値・固有名詞・日付）を推測で補わない
- 確たる事実が無ければ空配列にする（事実を捏造しない）
- sourceIndices は根拠とした出典リストの番号（1始まり）の配列。出典がなければ空配列

【立場で認識が分かれる事項の扱い（重要）】
- 立場・信仰・価値観・領土・歴史認識などで真偽の認識が分かれる主張（教義・規範・是非・帰属など）を、確定した共有客観事実として断定しない
- そうした事項は帰属・観測可能な形——「誰が何を主張／実効支配しているか」「文書化された出来事・日付」「科学的コンセンサスによれば〜」——でのみ記述する
- 裸の断定や評価的特徴づけ（「係争中」「未解決」等のラベル）は用いない。見解の相違が存在すること自体は「A国とB国がそれぞれ領有を主張している」のように帰属・観測形で書いてよいが、どちらが正しいかの裁定はしない
- 検証可能な出来事・結果・数値・日付を一部の立場が否定していても、否定の存在を理由に記述を取り下げない（確立事実は「科学的コンセンサスは〜とする」等の帰属・観測形で保持する）
- ここで出力する事実基盤は出典を辿るための best-effort な共通土台であり、検証済みの真実として位置づけない（システムは真偽を断定しない）`;
};

/**
 * トピック事実基盤を生成する（R1）。現在日付（now）を基準に grounding で客観的事実を収集し、
 * 既存の出典抽出・リダイレクト解決を経て出典付きに構造化する。grounding が事実を返さない／
 * 時事性が無い場合は捏造せず空の事実基盤（facts: []）を返す（成功扱い・R1.5/1.6）。
 */
export const runFactResearch = async (
	title: string,
	description: string,
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
			messages: [{ role: 'user', content: buildGroundingPrompt(title, description, now) }]
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
					content: buildStructuringPrompt(title, description, now, grounding.text, numberedSources)
				}
			]
		});

		const facts: FactItem[] = structuring.object.facts
			.filter((fact) => fact.statement.trim().length > 0)
			.map((fact) => {
				const sources = fact.sourceIndices
					.map((sourceIndex) => numberedSources[sourceIndex - 1])
					.filter((source): source is SearchResult => !!source);
				return { statement: fact.statement, sources };
			});

		// 情報量の天井診断: Phase1 レポート長・出典数に対し、Phase2 が何件・平均何文字の事実へ
		// 蒸留したか。事実が薄い場合、Phase1 レポートが短い（天井低）のか Phase2 が圧縮したのかを切り分ける。
		const avgLen = facts.length
			? Math.round(facts.reduce((sum, fact) => sum + fact.statement.length, 0) / facts.length)
			: 0;
		console.info(
			`[runFactResearch] groundingChars=${grounding.text.length} sources=${numberedSources.length} facts=${facts.length} avgStatementChars=${avgLen}`
		);

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
