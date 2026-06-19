import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { AI_MODELS, MAX_TOKENS } from '../constants/ai.constants.js';
import { formatPersonas } from '../utils/prompt-formatters.js';
import { buildNeutralitySystemPrompt } from './facilitator-agent.js';
import type { Chapter } from '../types/chapter.types.js';
import type { Persona } from '../types/persona.types.js';
import type { Result, PipelineError } from '../types/common.types.js';
import type { TopicContext } from '../types/topic.types.js';

const buildTopicContextSection = (topicContext?: TopicContext): string => {
	if (!topicContext) return '';
	const parts: string[] = [];
	if (topicContext.description) {
		parts.push(`\n\n【テーマの詳細説明】\n${topicContext.description}`);
	}
	if (topicContext.sourceContents?.length) {
		const sources = topicContext.sourceContents
			.map((c, i) => `--- 参考資料 ${i + 1} ---\n${c}`)
			.join('\n\n');
		parts.push(`\n\n【参考資料】\n${sources}`);
	}
	return parts.join('');
};

const issuesSchema = z.object({
	issues: z.array(z.string())
});

const chaptersSchema = z.object({
	chapters: z.array(
		z.object({
			title: z.string(),
			focusQuestion: z.string(),
			discussionPoints: z.array(z.string()).nullish()
		})
	)
});

export const generateChapters = async (
	topicTitle: string,
	personas: Persona[],
	topicContext?: TopicContext
): Promise<
	Result<
		{ chapters: Chapter[]; generalIssues: string[]; personaIssues: string[] },
		PipelineError
	>
> => {
	try {
		const contextSection = buildTopicContextSection(topicContext);
		const [generalIssuesResult, personaIssuesResult] = await Promise.all([
			generateObject({
				model: anthropic(AI_MODELS.SONNET),
				maxTokens: MAX_TOKENS.FACILITATOR_CHAPTER_ISSUES,
				system: buildNeutralitySystemPrompt(),
				schema: issuesSchema,
				messages: [
					{
						role: 'user',
						content: `テーマ「${topicTitle}」について、専門知識を持たない一般の人々が最初に感じる素朴な疑問や関心事を5〜7件列挙してください。\n\n日常の感覚で「自分にも関係ある」「なんとなく気になる」と思える切り口に絞ってください。固有名詞（特定の企業・人名・政策名）や専門用語は使わないこと。各切り口を1〜2文で記述してください。${contextSection}`
					}
				]
			}),
			generateObject({
				model: anthropic(AI_MODELS.SONNET),
				maxTokens: MAX_TOKENS.FACILITATOR_CHAPTER_ISSUES,
				system: buildNeutralitySystemPrompt(),
				schema: issuesSchema,
				messages: [
					{
						role: 'user',
						content: `テーマ「${topicTitle}」について、以下の参加者それぞれの立場・専門性・利害関係から生まれる具体的な論点や関心事を5〜8件列挙してください。\n\n参加者:\n${formatPersonas(personas)}\n\n各参加者が強い意見・懸念・利害を持つ側面を考慮し、参加者間で意見が対立しやすい切り口を優先してください。各切り口を1〜2文で記述してください。${contextSection}`
					}
				]
			})
		]);

		const generalIssues = generalIssuesResult.object.issues;
		const personaIssues = personaIssuesResult.object.issues;

		const chaptersResult = await generateObject({
			model: anthropic(AI_MODELS.SONNET),
			maxTokens: MAX_TOKENS.FACILITATOR_CHAPTER_STRUCTURE,
			system: buildNeutralitySystemPrompt(),
			schema: chaptersSchema,
			messages: [
				{
					role: 'user',
					content: `以下の2種類の切り口をもとに、討論の章立てを3〜6章に構成してください。\n\n【一般的な切り口（専門知識不要・日常感覚）】\n${generalIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\n\n【参加者固有の切り口（専門的・立場に基づく論点）】\n${personaIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\n\n各章に「章タイトル」「フォーカス問い」「discussionPoints（3〜5件の論点）」を設定してください。\n\n【discussionPoints の書き方】\n- 特定の参加者の名前・発言・主張を前提にした記述は禁止（例：「○○さんが指摘する〜」は不可）\n- 誰に向けても問いかけられる汎用的な問いの形で書く\n- 例：「〜という観点から、どのような課題が生じるか」「〜が失われた場合、社会はどう対処できるか」\n\n【構成の原則・厳守事項】\n- 第1章は必ず「一般的な切り口」から選ぶこと。固有名詞・専門用語・業界用語を第1章のタイトルとフォーカス問いに含めてはならない。\n- 第1章の discussionPoints は、専門知識のない人でも日常感覚で答えられる切り口にすること。固有名詞・専門用語は第2章以降の論点から導入してよい。\n- 章を追うごとに「参加者固有の切り口」を取り込み、専門性・対立の鋭さを段階的に増す。固有名詞や専門用語は第3章以降から自然に導入してよい。\n- 「誰でも感覚的に答えられる入口 → 具体的な事例・比較 → 深いジレンマ・価値観の対立」の順に進むこと。`
				}
			]
		});

		const debateChapters: Chapter[] = chaptersResult.object.chapters.map((c) => ({
			id: nanoid(),
			title: c.title,
			focusQuestion: c.focusQuestion,
			discussionPoints: c.discussionPoints ?? []
		}));

		return { ok: true, value: { chapters: debateChapters, generalIssues, personaIssues } };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};
