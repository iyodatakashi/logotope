import { generateText, tool, jsonSchema } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { nanoid } from 'nanoid';
import { AI_MODELS, MAX_TOKENS } from '../constants/ai.constants.js';
import { formatPersonas } from '../utils/prompt-formatters.js';
import { buildNeutralitySystemPrompt } from './facilitator-agent.js';
import type { Chapter } from '../types/chapter.types.js';
import type { Persona } from '../types/persona.types.js';
import type { Result, PipelineError } from '../types/common.types.js';

const SUBMIT_ISSUES_TOOL = tool({
	description: '討論テーマに関する多様な切り口をフラットに列挙する',
	parameters: jsonSchema({
		type: 'object' as const,
		properties: {
			issues: {
				type: 'array',
				items: { type: 'string' },
				description:
					'7〜10件の切り口（賛否・問題提起に偏らず、このテーマに関して人々が関心を持つ様々な側面を網羅的に列挙。各切り口を1〜2文で記述）'
			}
		},
		required: ['issues']
	})
});

export const SUBMIT_CHAPTERS_TOOL = tool({
	description: '列挙した切り口をもとに討論の章立てを構成する（目安3〜6章）',
	parameters: jsonSchema({
		type: 'object' as const,
		properties: {
			chapters: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						title: { type: 'string', description: '章タイトル' },
						focusQuestion: { type: 'string', description: '討論フォーカス問い' },
						discussionPoints: {
							type: 'array',
							items: { type: 'string' },
							description: 'この章で押さえるべき論点を3〜5件。focusQuestion に沿った多様な切り口'
						}
					},
					required: ['title', 'focusQuestion', 'discussionPoints']
				}
			}
		},
		required: ['chapters']
	})
});

export const generateChapters = async (
	topicTitle: string,
	personas: Persona[]
): Promise<
	Result<
		{ chapters: Chapter[]; generalIssues: string[]; personaIssues: string[] },
		PipelineError
	>
> => {
	try {
		const [generalIssuesResult, personaIssuesResult] = await Promise.all([
			generateText({
				model: anthropic(AI_MODELS.SONNET),
				maxTokens: MAX_TOKENS.FACILITATOR_CHAPTER_ISSUES,
				system: buildNeutralitySystemPrompt(),
				tools: { submit_issues: SUBMIT_ISSUES_TOOL },
				toolChoice: { type: 'tool', toolName: 'submit_issues' },
				messages: [
					{
						role: 'user',
						content: `テーマ「${topicTitle}」について、専門知識を持たない一般の人々が最初に感じる素朴な疑問や関心事を5〜7件列挙してください。\n\n日常の感覚で「自分にも関係ある」「なんとなく気になる」と思える切り口に絞ってください。固有名詞（特定の企業・人名・政策名）や専門用語は使わないこと。各切り口を1〜2文で記述してください。`
					}
				]
			}),
			generateText({
				model: anthropic(AI_MODELS.SONNET),
				maxTokens: MAX_TOKENS.FACILITATOR_CHAPTER_ISSUES,
				system: buildNeutralitySystemPrompt(),
				tools: { submit_issues: SUBMIT_ISSUES_TOOL },
				toolChoice: { type: 'tool', toolName: 'submit_issues' },
				messages: [
					{
						role: 'user',
						content: `テーマ「${topicTitle}」について、以下の参加者それぞれの立場・専門性・利害関係から生まれる具体的な論点や関心事を5〜8件列挙してください。\n\n参加者:\n${formatPersonas(personas)}\n\n各参加者が強い意見・懸念・利害を持つ側面を考慮し、参加者間で意見が対立しやすい切り口を優先してください。各切り口を1〜2文で記述してください。`
					}
				]
			})
		]);

		const generalIssuesCall = generalIssuesResult.toolCalls[0];
		const personaIssuesCall = personaIssuesResult.toolCalls[0];
		if (!generalIssuesCall || !personaIssuesCall) {
			return {
				ok: false,
				error: {
					code: 'AI_API_ERROR',
					message: 'No tool_use block in issues response',
					retryable: true
				}
			};
		}
		const { issues: generalIssues } = generalIssuesCall.args as { issues: string[] | undefined };
		const { issues: personaIssues } = personaIssuesCall.args as { issues: string[] | undefined };
		if (!Array.isArray(generalIssues) || !Array.isArray(personaIssues)) {
			return {
				ok: false,
				error: { code: 'AI_API_ERROR', message: 'Missing issues array in AI response', retryable: true }
			};
		}

		const chaptersResult = await generateText({
			model: anthropic(AI_MODELS.SONNET),
			maxTokens: MAX_TOKENS.FACILITATOR_CHAPTER_STRUCTURE,
			system: buildNeutralitySystemPrompt(),
			tools: { submit_chapters: SUBMIT_CHAPTERS_TOOL },
			toolChoice: { type: 'tool', toolName: 'submit_chapters' },
			messages: [
				{
					role: 'user',
					content: `以下の2種類の切り口をもとに、討論の章立てを3〜6章に構成してください。\n\n【一般的な切り口（専門知識不要・日常感覚）】\n${generalIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\n\n【参加者固有の切り口（専門的・立場に基づく論点）】\n${personaIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\n\n各章に「章タイトル」「フォーカス問い」「discussionPoints（3〜5件の論点）」を設定してください。\n\n【構成の原則・厳守事項】\n- 第1章は必ず「一般的な切り口」から選ぶこと。固有名詞・専門用語・業界用語を第1章のタイトルとフォーカス問いに含めてはならない。\n- 第1章の discussionPoints は、専門知識のない人でも日常感覚で答えられる切り口にすること。固有名詞・専門用語は第2章以降の論点から導入してよい。\n- 章を追うごとに「参加者固有の切り口」を取り込み、専門性・対立の鋭さを段階的に増す。固有名詞や専門用語は第3章以降から自然に導入してよい。\n- 「誰でも感覚的に答えられる入口 → 具体的な事例・比較 → 深いジレンマ・価値観の対立」の順に進むこと。`
				}
			]
		});

		const chaptersCall = chaptersResult.toolCalls[0];
		if (!chaptersCall) {
			return {
				ok: false,
				error: {
					code: 'AI_API_ERROR',
					message: 'No tool_use block in chapters response',
					retryable: true
				}
			};
		}
		const { chapters } = chaptersCall.args as {
			chapters: Array<{ title: string; focusQuestion: string; discussionPoints?: string[] }> | undefined;
		};
		if (!Array.isArray(chapters)) {
			return {
				ok: false,
				error: { code: 'AI_API_ERROR', message: 'Missing chapters array in AI response', retryable: true }
			};
		}

		const debateChapters: Chapter[] = chapters.map((c) => ({
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
