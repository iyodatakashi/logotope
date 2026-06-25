import { generateText, generateObject } from 'ai';
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
import type { DebateTurn } from '../../types/turn.types.js';
import type { FactCheckFinding } from '../../types/fact-check.types.js';
import type { Result, PipelineError } from '../../types/common.types.js';

const findingSchema = z.object({
	claim: z.string(),
	verdict: z.enum(['incorrect', 'unverifiable']),
	correction: z.string(),
	reason: z.string(),
	sourceIndices: z.array(z.number())
});

const phase2Schema = z.object({ findings: z.array(findingSchema) });

// 検証対象の発言が属する討論の文脈（テーマ・章）。発言を単独で検証すると一般論に流れるため必須。
export type FactCheckContext = {
	topicTitle: string;
	chapterTitle: string;
	focusQuestion: string;
};

const buildContextSection = (context?: FactCheckContext): string => {
	if (!context) return '';
	const focus = context.focusQuestion ? `（${context.focusQuestion}）` : '';
	return `【討論のテーマ】${context.topicTitle}
【この章で議論していること】${context.chapterTitle}${focus}

この発言は上記テーマの討論の一部です。一般論ではなく、このテーマ・状況に即して事実性を検証してください。

`;
};

const buildPhase1Prompt = (content: string, context?: FactCheckContext): string =>
	`${buildContextSection(context)}次の発言に含まれる「検証可能な事実主張」を、誤り・実態と異なる証拠を優先的に探して検証してください（反証起点）。

【検証の姿勢】
- 意見・価値判断は対象外。事実主張のみを検証する
- 主張が誤っている証拠を優先的に検索し、正しい事実・理由を確認する
- 当事者の証言・統計・公式情報を根拠にする

【対象の発言】
${content}

検索結果を踏まえ、各事実主張について「引用（発言からの抜粋）・誤っている箇所・正しい事実・理由」を記述してください。
※本文中にURL（http/https）を一切記載しないこと。出典は媒体名・調査機関名で示すこと。参照元リンクはシステムが検索情報から自動収集します。`;

const buildPhase2Prompt = (
	content: string,
	verificationText: string,
	numberedSources: SearchResult[],
	context?: FactCheckContext
): string => {
	const sourceList = numberedSources.length
		? numberedSources.map((s, i) => `${i + 1}. ${s.url}`).join('\n')
		: '（出典なし）';
	return `${buildContextSection(context)}以下の発言と、その検証レポート・出典リストをもとに、事実誤認の指摘を構造化してください。

【対象の発言】
${content}

【検証レポート】
${verificationText}

【出典リスト（番号付き）】
${sourceList}

【出力ルール】
- 事実上の誤りがない主張は finding を生成しない
- claim は対象の発言からの正確な引用（部分文字列）にする
- verdict は incorrect（事実と異なる）または unverifiable（裏付けが得られない）
- correction は正しい事実（unverifiable のときは空でよい）
- reason はそう判断した理由
- sourceIndices は根拠とした出典リストの番号（1始まり）の配列。出典がなければ空配列`;
};

/** 1つの発言を Phase1（grounding 検証）→ Phase2（構造化）で検証し、指摘の配列を返す（2.2） */
export const checkTurn = async (
	turn: DebateTurn,
	context?: FactCheckContext
): Promise<Result<FactCheckFinding[], PipelineError>> => {
	const google = getGoogleProvider();
	if (!google) {
		return {
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'GEMINI_API_KEY is not set', retryable: false }
		};
	}

	try {
		const phase1 = await generateText({
			model: google(PIPELINE_MODELS.factCheckGrounding),
			tools: { google_search: google.tools.googleSearch({}) },
			messages: [{ role: 'user', content: buildPhase1Prompt(turn.content, context) }]
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
					content: buildPhase2Prompt(turn.content, phase1.text, numberedSources, context)
				}
			]
		});

		const speakerType = turn.speakerType === 'facilitator' ? 'facilitator' : 'persona';
		const findings: FactCheckFinding[] = [];
		phase2.object.findings.forEach((f, i) => {
			// claim は当該発言本文の部分文字列であることを照合（ハルシネーション引用を破棄）
			if (!turn.content.includes(f.claim)) return;
			const sources = f.sourceIndices
				.map((idx) => numberedSources[idx - 1])
				.filter((s): s is SearchResult => !!s);
			// 出典が得られない主張は検証不能とする（3.4, 3.6）
			const verdict = sources.length === 0 ? 'unverifiable' : f.verdict;
			findings.push({
				id: `${turn.id}-${i}`,
				turnId: turn.id,
				speakerType,
				claim: f.claim,
				verdict,
				correction: f.correction,
				reason: f.reason,
				sources
			});
		});

		return { ok: true, value: findings };
	} catch (err) {
		console.error('[checkTurn] error', { turnId: turn.id }, err);
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
		focusQuestion: chapter.focusQuestion
	};

	const turns = chapter.turns.filter(
		(t) => t.speakerType === 'persona' || t.speakerType === 'facilitator'
	);

	const allFindings: FactCheckFinding[] = [];
	for (const turn of turns) {
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
