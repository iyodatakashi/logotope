import { generateText, generateObject } from 'ai';
import { z } from 'zod';
import { getPipelineModel, getGoogleProvider } from '../llm/models.js';
import { PIPELINE_MODELS } from '../constants/ai.constants.js';
import {
	extractSources,
	resolveSourceUrls,
	type GroundingMetadata,
	type SearchSource
} from '../search/grounding.js';
import { formatFactBaseSection } from '../utils/prompt-formatters.js';
import type { Persona } from '../types/persona.types.js';
import type { TopicContext } from '../types/topic.types.js';
import type { Result, PipelineError } from '../types/common.types.js';

const MAX_SOURCE_CHARS = 3_000;

export type DraftBelief = {
	stanceAndGrounds: string;
	coreClaims: string;
	concerns: string;
	values: string;
	compromisePoints: string;
	changePotential: string;
};

export type InterviewOutput = {
	draftBelief: DraftBelief;
	verificationReport: string;
	interviewRecord: string;
	initialBelief: string;
	sources: SearchSource[];
};

const draftBeliefSchema = z.object({
	stanceAndGrounds: z.string(),
	coreClaims: z.string(),
	concerns: z.string(),
	values: z.string(),
	compromisePoints: z.string(),
	changePotential: z.string()
});

const finalBeliefSchema = z.object({
	initialBelief: z.string(),
	interviewRecord: z.string()
});

export const runInterview = async (
	topicTitle: string,
	persona: Persona,
	topicContext?: TopicContext
): Promise<Result<InterviewOutput, PipelineError>> => {
	const draftResult = await generateDraftBelief(topicTitle, persona, topicContext);
	if (!draftResult.ok) return draftResult;

	const verifyResult = await verifyWithGrounding(
		topicTitle,
		persona,
		draftResult.value,
		topicContext
	);
	if (!verifyResult.ok) return verifyResult;

	const finalResult = await generateFinalBelief(
		topicTitle,
		persona,
		draftResult.value,
		verifyResult.value.verificationReport,
		topicContext
	);
	if (!finalResult.ok) return finalResult;

	return {
		ok: true,
		value: {
			draftBelief: draftResult.value,
			verificationReport: verifyResult.value.verificationReport,
			interviewRecord: finalResult.value.interviewRecord,
			initialBelief: finalResult.value.initialBelief,
			sources: verifyResult.value.sources
		}
	};
};

const generateDraftBelief = async (
	topicTitle: string,
	persona: Persona,
	topicContext?: TopicContext
): Promise<Result<DraftBelief, PipelineError>> => {
	const contextSection = buildTopicContextSection(topicContext);
	try {
		const result = await generateObject({
			model: getPipelineModel('personaInterview'),
			schema: draftBeliefSchema,
			messages: [
				{
					role: 'user',
					content: `テーマ「${topicTitle}」について、以下のペルソナが持つ信念ドキュメントのドラフトを生成してください。
外部検索は行わず、あなたの知識のみで生成してください。ステレオタイプで構いません（後の検証フェーズで修正します）。${contextSection}

【ペルソナ情報】
氏名: ${persona.name}
年齢: ${persona.age}歳
職業: ${persona.occupation}
立場: ${persona.specificRole}
背景: ${persona.background}
関心事: ${persona.interests}

以下の6項目を構造化して生成してください:
- stanceAndGrounds: このペルソナの立場と根拠
- coreClaims: 核心的主張
- concerns: 懸念事項
- values: 価値観
- compromisePoints: 妥協できる点
- changePotential: 考えが変わる可能性と条件`
				}
			]
		});
		return { ok: true, value: result.object };
	} catch (err) {
		console.error('[runInterview] Phase1 (generateDraftBelief) error', err);
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

const verifyWithGrounding = async (
	topicTitle: string,
	persona: Persona,
	draft: DraftBelief,
	topicContext?: TopicContext
): Promise<Result<{ verificationReport: string; sources: SearchSource[] }, PipelineError>> => {
	const google = getGoogleProvider();
	if (!google) {
		return {
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'GEMINI_API_KEY is not set', retryable: false }
		};
	}

	const factSection = formatFactBaseSection(topicContext?.factBase);

	try {
		const result = await generateText({
			model: google(PIPELINE_MODELS.personaInterview),
			tools: {
				google_search: google.tools.googleSearch({})
			},
			messages: [
				{
					role: 'user',
					content: `テーマ「${topicTitle}」に対するペルソナ「${persona.name}」（${persona.age}歳、${persona.occupation}）の信念ドラフトについて、各項目が誤り・実態と異なる証拠を優先的に探してください（反証起点）。

【検索の対象（重要）】
- 検索するのは「このペルソナ固有の信念（立場・価値観・懸念）」の反証だけに限定する
- テーマの一般的・客観的事実は下記の【確定した客観的事実（共通前提）】で既に共有済みなので、それらを重ねて検索しない（重複検索の禁止）
- 「このステレオタイプは本当に正しいか」「実態が異なる証拠はないか」を主軸に検索する
- ドラフトの主張を確認するのではなく、それを否定・修正しうる情報を優先的に探す
- 当事者の証言・統計・実態調査を検索で探し、ドラフトとの乖離を記録する${factSection}

【ドラフト信念】
- 立場と根拠: ${draft.stanceAndGrounds}
- 核心的主張: ${draft.coreClaims}
- 懸念事項: ${draft.concerns}
- 価値観: ${draft.values}
- 妥協点: ${draft.compromisePoints}
- 変化の可能性: ${draft.changePotential}

検索結果を踏まえ、以下の書式で検証レポートを出力してください。
※本文中にURL（http/https）を一切記載しないこと。URLを書くと事実と異なるリンクを生成してしまうため、出典は媒体名・調査機関名で示すこと。参照元リンクはシステムが検索情報から自動収集します。

## 一致点
- ドラフトの主張: [項目]
  実態: [検証で確認された内容]
  出典: [媒体名・調査機関名]

## 相違点
- ギャップ: [ドラフトの主張と実態のズレ]
  実態: [検証で判明した実態]
  出典: [媒体名・調査機関名]

## 新発見
- 観点: [ステレオタイプでは見えていなかった側面]
  内容: [具体的な内容]
  出典: [媒体名・調査機関名]`
				}
			]
		});

		const googleMeta = result.providerMetadata?.['google'] as
			| { groundingMetadata?: GroundingMetadata }
			| undefined;
		const groundingMetadata = googleMeta?.groundingMetadata;

		// テーマ事実の収集責務は共有事実基盤へ移管したため、信念反証の検索が空でもエラーにしない（R6.3/6.5）。
		// 得られた範囲の検証レポートで後続フェーズを続行する（出典は空）。
		if (!groundingMetadata || !groundingMetadata.groundingChunks?.length) {
			console.info('[runInterview] Phase2 (verifyWithGrounding): no belief-refutation sources');
			return { ok: true, value: { verificationReport: result.text, sources: [] } };
		}

		const sources = extractSources(groundingMetadata, result.text.slice(0, 500));
		const resolvedSources = await resolveSourceUrls(sources);

		return { ok: true, value: { verificationReport: result.text, sources: resolvedSources } };
	} catch (err) {
		console.error('[runInterview] Phase2 (verifyWithGrounding) error', err);
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

const generateFinalBelief = async (
	topicTitle: string,
	persona: Persona,
	draft: DraftBelief,
	verificationReport: string,
	topicContext?: TopicContext
): Promise<Result<{ initialBelief: string; interviewRecord: string }, PipelineError>> => {
	const factSection = formatFactBaseSection(topicContext?.factBase);
	try {
		const result = await generateObject({
			model: getPipelineModel('personaInterview'),
			schema: finalBeliefSchema,
			messages: [
				{
					role: 'user',
					content: `テーマ「${topicTitle}」について、ペルソナ「${persona.name}」（${persona.age}歳、${persona.occupation}、${persona.specificRole}）の最終的な信念ドキュメントと取材記録をゼロから生成してください。

【重要な指示】
- 下記のドラフト信念は「出発点」ではなく「比較参照」として扱うこと
- 検証レポートで判明したギャップ・新発見を最大限反映する
- ステレオタイプの一般論ではなく、このペルソナ固有の経験・葛藤・価値観を描く
- 取材記録は1000字以上の具体的な質疑応答形式で書く
- 【確定した客観的事実（共通前提）】がある場合、このペルソナに関連する具体的事実は一般論に薄めず具体的に反映する。関連する事実が無ければ無理に盛り込まない${factSection}

【比較参照：ドラフト信念（ステレオタイプ仮説）】
- 立場と根拠: ${draft.stanceAndGrounds}
- 核心的主張: ${draft.coreClaims}
- 懸念事項: ${draft.concerns}
- 価値観: ${draft.values}
- 妥協点: ${draft.compromisePoints}
- 変化の可能性: ${draft.changePotential}

【検証レポート（Google検索グラウンディングによる反証的検証結果）】
${verificationReport}

【ペルソナ情報】
氏名: ${persona.name}
年齢: ${persona.age}歳
職業: ${persona.occupation}
立場: ${persona.specificRole}
背景: ${persona.background}
関心事: ${persona.interests}

以下の2項目を生成してください。

【initialBelief（最終信念ドキュメント）の書式】
- 6項目（立場と根拠・核心的主張・懸念事項・価値観・妥協点・変化の可能性）を、必ず「## 見出し」+ 本文段落の形式で書く
- 見出しは「##」のみを使う（「#」や「**項目名**」で項目名を書かない。項目全体を太字で囲まない）
- 出力例:
## 立場と根拠
（ここに本文段落）

## 核心的主張
（ここに本文段落）

（以降、懸念事項・価値観・妥協点・変化の可能性も同じ形式で6項目すべて記述する）

【interviewRecord（仮想取材記録）の書式】
- 記者の質問と${persona.name}さんの回答を交互に、「**Q.**」「**A.**」で書く
- 各Q&Aブロックの間は必ず空行で区切る
- 全体で1000字以上にする
- 出力例:
**Q.** （記者の質問）

**A.** （${persona.name}さんの回答）

**Q.** （次の質問）

**A.** （次の回答）`
				}
			]
		});
		return { ok: true, value: result.object };
	} catch (err) {
		console.error('[runInterview] Phase3 (generateFinalBelief) error', err);
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

const buildTopicContextSection = (topicContext?: TopicContext): string => {
	if (!topicContext) return '';
	const parts: string[] = [];
	if (topicContext.description) {
		parts.push(`\n【テーマの詳細説明】\n${topicContext.description}`);
	}
	if (topicContext.sourceContents?.length) {
		const sources = topicContext.sourceContents
			.map((c, i) => `--- 参考資料 ${i + 1} ---\n${c.slice(0, MAX_SOURCE_CHARS)}`)
			.join('\n\n');
		parts.push(`\n【参考資料】\n${sources}`);
	}
	parts.push(formatFactBaseSection(topicContext.factBase));
	return parts.join('\n');
};
