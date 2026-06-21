import { generateObject } from 'ai';
import { z } from 'zod';
import { anthropic } from '@ai-sdk/anthropic';
import { AI_MODELS } from '../constants/ai.constants.js';
import { formatTurns, formatPersonas, currentDateString } from '../utils/prompt-formatters.js';
import type { DebateTurn } from '../types/debate.types.js';
import type { Persona } from '../types/persona.types.js';
import type { FacilitatorReply } from '../types/debate.types.js';
import type { Chapter } from '../types/chapter.types.js';
import type { Result, PipelineError } from '../types/common.types.js';

export const buildNeutralitySystemPrompt = (): string =>
	`本日は ${currentDateString()} です。時事的な話題に言及する際はこの日付を基準にしてください。` +
	'あなたはテレビ討論番組のプロの司会者です。特定の立場への誘導は禁止しますが、議論を具体的な論点に絞り込んで進行するのがあなたの役割です。' +
	'「建設的な議論を」「様々な視点から」のような抽象的な言葉は使わない。' +
	'常に「〜についてはどうですか？」「〜という点で○○さんはどう思いますか？」のように具体的な問いかけで誘導する。' +
	'発言は2〜3文以内。演説禁止。';

const facilitatorReplyWithTargetSchema = z.object({
	targetPersonaId: z.string(),
	content: z.string()
});

const contentOnlySchema = z.object({
	content: z.string()
});

const interventionSchema = z.object({
	targetPersonaId: z.string().optional(),
	content: z.string().optional(),
	selectedDiscussionPointIndex: z.number().optional()
});

const coverageSchema = z.object({
	addressedIndices: z.array(z.number()).nullish()
});

const runInterventionCheck = async (
	turns: DebateTurn[],
	personas: Persona[],
	currentChapter: Chapter | undefined,
	criteriaSection: string
): Promise<Result<FacilitatorReply, PipelineError>> => {
	try {
		const chapterContext = currentChapter
			? `\n\n【この章のミッション】「${currentChapter.title}」\nフォーカス問い: ${currentChapter.focusQuestion}\n司会の役割: この章の間、会話が常にこのフォーカス問いに関連するよう誘導する。`
			: '';

		const result = await generateObject({
			model: anthropic(AI_MODELS.SONNET),
			system: buildNeutralitySystemPrompt(),
			schema: interventionSchema,
			messages: [
				{
					role: 'user',
					content: `現在の討論を評価し、司会として介入すべきか判断してください。\n\n会話履歴（現在の章のみ）:\n${formatTurns(turns.slice(-20), personas)}\n\n参加者:\n${formatPersonas(personas)}${chapterContext}${criteriaSection}`
				}
			]
		});

		const { content, targetPersonaId, selectedDiscussionPointIndex } = result.object;
		return { ok: true, value: { content, targetPersonaId, selectedDiscussionPointIndex } };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};

export const generateOpening = async (
	topicTitle: string,
	personas: Persona[],
	firstChapter?: Chapter
): Promise<Result<FacilitatorReply, PipelineError>> => {
	try {
		const chapterContext = firstChapter
			? `\n\n第1章「${firstChapter.title}」のフォーカス: ${firstChapter.focusQuestion}`
			: '';
		const hasPoints = (firstChapter?.discussionPoints?.length ?? 0) > 0;
		const firstPointContext =
			hasPoints && firstChapter
				? `\n\nこの章の最初の論点: ${firstChapter.discussionPoints[0]}。この論点を最初の問いかけの切り口として使ってください。`
				: '';

		const result = await generateObject({
			model: anthropic(AI_MODELS.SONNET),
			system: buildNeutralitySystemPrompt(),
			schema: facilitatorReplyWithTargetSchema,
			messages: [
				{
					role: 'user',
					content: `テーマ「${topicTitle}」の討論を開始してください。\n\n参加者:\n${formatPersonas(personas)}${chapterContext}${firstPointContext}\n\n冒頭発言（2〜3文）の構成：\n1. 第1章のフォーカス問いの趣旨に沿って、「このテーマに詳しくない人でも感覚的に答えられる」オープンな問いかけをする。固有名詞（特定の映像作品・企業名・人名・統計）や専門用語を使わないこと。誰もが「自分の立場から答えられそう」と感じる入口となる問いにする。\n2. 最初の発言者にその問いを向ける\n\n「議論を始めましょう」などの抽象的な言葉は禁止。専門知識なしでも答えられる具体的な問いで始める。targetPersonaIdには必ず上記リストのIDを使用してください。`
				}
			]
		});

		const { content, targetPersonaId } = result.object;
		return {
			ok: true,
			value: { content, targetPersonaId, selectedDiscussionPointIndex: hasPoints ? 0 : undefined }
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};

/** A（論点ずれ）: 会話がフォーカス問いから逸脱しているときだけ介入し、論点を引き戻す。指名済みターンでも上書きしうる */
export const evaluateTopicDrift = async (
	turns: DebateTurn[],
	personas: Persona[],
	speakCount: Map<string, number> = new Map(),
	currentChapter?: Chapter,
	unaddressedDiscussionPoints?: string[]
): Promise<Result<FacilitatorReply, PipelineError>> => {
	const speakCountInfo = personas
		.map((p) => `${p.name}: ${speakCount.get(p.id) ?? 0}回`)
		.join(', ');

	const hasPoints = (unaddressedDiscussionPoints?.length ?? 0) > 0;
	const pointsContext = hasPoints
		? `\n\n【未完了論点リスト（インデックス順）】\n${unaddressedDiscussionPoints!.map((p, i) => `${i}. ${p}`).join('\n')}\n\n【三択判断】以下のいずれかを選択してください（流れ最優先）:\n1. 会話がフォーカス問いから逸脱している → 引き戻す（content・targetPersonaId を指定。selectedDiscussionPointIndex は省略）\n2. 逸脱していないが現在の論点が一段落しており、未完了論点へ自然に移れる → 未完了論点を1件投入する（content・targetPersonaId・selectedDiscussionPointIndex を指定）\n3. 流れが深まっている最中 → 介入しない（content・targetPersonaId を省略）\n\n論点を投入する場合は selectedDiscussionPointIndex に上記リストのインデックスを指定してください。`
		: '';

	const fallbackCriteria = hasPoints
		? ''
		: '\n\n会話がこの章のフォーカス問いから明確に逸脱している（別の話題に流れている）場合のみ介入してください。逸脱していなければ content と targetPersonaId は省略してください。\n\n介入する場合は、フォーカス問いに引き戻す論点を決め、ふさわしい参加者を1人選んで targetPersonaId に設定してください。content は、まず話が逸れていることに触れて「すみません、少し話を戻しましょう」「本題に戻すと」のように本題への引き戻しを明示してから、その人に「○○さん、〜についてはどうですか？」と名前で呼びかけて具体的に問いかけてください。';
	const criteria = `\n\n累計発言数: ${speakCountInfo}${pointsContext}${fallbackCriteria}`;
	return runInterventionCheck(turns, personas, currentChapter, criteria);
};

/** B（出尽くし）: 今の論点で議論が落ち着いたとき、まだ議論されていない新しい論点に切り替えて次の話者を振る */
export const evaluateStallIntervention = async (
	turns: DebateTurn[],
	personas: Persona[],
	speakCount: Map<string, number> = new Map(),
	currentChapter?: Chapter,
	unaddressedDiscussionPoints?: string[]
): Promise<Result<FacilitatorReply, PipelineError>> => {
	const speakCountInfo = personas
		.map((p) => `${p.name}: ${speakCount.get(p.id) ?? 0}回`)
		.join(', ');

	const hasPoints = (unaddressedDiscussionPoints?.length ?? 0) > 0;
	const pointsContext = hasPoints
		? `\n\n【未完了論点リスト（インデックス順）】\n${unaddressedDiscussionPoints!.map((p, i) => `${i}. ${p}`).join('\n')}\n\n流れが有効な方向に進んでいればそれを優先してください。流れが落ち着いていれば未完了論点から最適な1件を投入し、selectedDiscussionPointIndex に該当インデックスを指定してください。1介入1論点です。`
		: '';

	const criteria = `\n\n累計発言数: ${speakCountInfo}${pointsContext}\n\nこの章の今の論点は議論が出尽くし、落ち着いています。まだ十分に議論されていない新しい論点に切り替えて、特定の参加者に振ってください。章をいつ終えるかはあなたの判断対象外です。\n\n手順：\n(1) この章のフォーカス問いに沿って、まだ十分に議論されていない新しい論点を決める。\n(2) その論点を話すのにふさわしい参加者を1人選び、targetPersonaId に参加者リストのIDを設定する（必須）。基準: 関連性が高い人。同程度なら発言数の少ない人を優先。\n(3) content を書く。targetPersonaId の参加者に「○○さん、〜についてはどうですか？」のように名前で呼びかけ、(1)で決めた論点に関する具体的な問いかけにする。\n\n適切な切り替え先が無ければ content と targetPersonaId は省略してください。`;
	return runInterventionCheck(turns, personas, currentChapter, criteria);
};

export const generateClosing = async (
	turns: DebateTurn[],
	finalBeliefs: Map<string, string>,
	personas: ReadonlyArray<Persona> = []
): Promise<Result<string, PipelineError>> => {
	try {
		const beliefsSummary = Array.from(finalBeliefs.entries())
			.map(([id, belief]) => `ペルソナ ${id}:\n${belief}`)
			.join('\n\n');

		const result = await generateObject({
			model: anthropic(AI_MODELS.SONNET),
			system: buildNeutralitySystemPrompt(),
			schema: contentOnlySchema,
			messages: [
				{
					role: 'user',
					content: `討論が終了しました。クロージング発言を3〜4文で作成してください（簡潔な締め括りのみ。長い総括は不要）。\n\n会話全体:\n${formatTurns(turns, personas)}\n\n各参加者の最終信念:\n${beliefsSummary}`
				}
			]
		});

		return { ok: true, value: result.object.content };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};

export const generateChapterSummary = async (
	recentHistory: DebateTurn[],
	currentChapter: Chapter,
	personas: ReadonlyArray<Persona> = []
): Promise<Result<string, PipelineError>> => {
	try {
		const result = await generateObject({
			model: anthropic(AI_MODELS.SONNET),
			system: buildNeutralitySystemPrompt(),
			schema: contentOnlySchema,
			messages: [
				{
					role: 'user',
					content: `章「${currentChapter.title}」の議論をまとめる発言を生成してください。次の章への言及は不要です。この章で出た主な意見・対立点を簡潔にまとめてください。\n\n直近の会話:\n${formatTurns(recentHistory.slice(-10), personas)}`
				}
			]
		});

		return { ok: true, value: result.object.content };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};

export const generateChapterIntroduction = async (
	nextChapter: Chapter,
	personas: Persona[]
): Promise<Result<FacilitatorReply, PipelineError>> => {
	try {
		const hasPoints = (nextChapter.discussionPoints?.length ?? 0) > 0;
		const firstPointContext = hasPoints
			? `\n\nこの章の最初の論点: ${nextChapter.discussionPoints[0]}。この論点を導入の問いかけの切り口として使ってください。`
			: '';

		const result = await generateObject({
			model: anthropic(AI_MODELS.SONNET),
			system: buildNeutralitySystemPrompt(),
			schema: facilitatorReplyWithTargetSchema,
			messages: [
				{
					role: 'user',
					content: `次の章「${nextChapter.title}」を始める導入発言を生成してください。前の章には触れず、このフォーカス問いについて参加者に問いかける形で始めてください。最初に発言させるペルソナIDも指定してください。\n\nフォーカス: ${nextChapter.focusQuestion}${firstPointContext}\n\n参加者:\n${formatPersonas(personas)}\n\ntargetPersonaIdには必ず上記リストのIDを使用してください。`
				}
			]
		});

		const { content, targetPersonaId } = result.object;
		return {
			ok: true,
			value: { content, targetPersonaId, selectedDiscussionPointIndex: hasPoints ? 0 : undefined }
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};

export const evaluateDiscussionPointCoverage = async (
	chapterTurns: DebateTurn[],
	incompletePoints: string[],
	personas: ReadonlyArray<Persona> = []
): Promise<Result<number[], PipelineError>> => {
	try {
		const pointsList = incompletePoints.map((p, i) => `${i}. ${p}`).join('\n');

		const result = await generateObject({
			model: anthropic(AI_MODELS.SONNET),
			system: buildNeutralitySystemPrompt(),
			schema: coverageSchema,
			messages: [
				{
					role: 'user',
					content: `以下の各論点について、チャプターのターンで実質的な議論が行われたか評価してください。\n\n【未完了論点リスト】\n${pointsList}\n\n【チャプターターン】\n${formatTurns(chapterTurns, personas)}\n\n評価基準: 各論点について「その論点に関する具体的な意見・主張・事例が述べられている」場合のみ消化済みと判定してください。話題に触れただけでは不十分です。消化済みと判定した論点のインデックスを addressedIndices に含めてください。`
				}
			]
		});

		return { ok: true, value: result.object.addressedIndices ?? [] };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};
