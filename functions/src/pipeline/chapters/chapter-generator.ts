import Anthropic from '@anthropic-ai/sdk';
import { nanoid } from 'nanoid';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { AI_MODELS, MAX_TOKENS } from '../../constants/ai.constants.js';
import { formatPersonas } from '../../utils/prompt-formatters.js';
import { buildNeutralitySystemPrompt } from '../../agents/facilitator-agent.js';
import { getTopicById, getPersonasByTopicId } from '../../db/repository.js';
import type { Chapter } from '../../types/chapter.types.js';
import type { Persona } from '../../types/persona.types.js';
import type { Result, PipelineError } from '../../types/common.types.js';

const client = new Anthropic();
const db = () => getFirestore();

const SUBMIT_ISSUES_TOOL: Anthropic.Tool = {
	name: 'submit_issues',
	description: '討論テーマに関する多様な切り口をフラットに列挙する',
	input_schema: {
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
	}
};

const SUBMIT_CHAPTERS_TOOL: Anthropic.Tool = {
	name: 'submit_chapters',
	description: '列挙した切り口をもとに討論の章立てを構成する（目安3〜6章）',
	input_schema: {
		type: 'object' as const,
		properties: {
			chapters: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						title: { type: 'string', description: '章タイトル' },
						focusQuestion: { type: 'string', description: '討論フォーカス問い' }
					},
					required: ['title', 'focusQuestion']
				}
			}
		},
		required: ['chapters']
	}
};

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
		// Step 1: 切り口洗い出し（一般切り口とペルソナ固有切り口を並列生成）
		const [generalIssuesResponse, personaIssuesResponse] = await Promise.all([
			// 1a: トピックのみ（日常感覚・専門知識不要）
			client.messages.create({
				model: AI_MODELS.SONNET,
				max_tokens: MAX_TOKENS.FACILITATOR_CHAPTER_ISSUES,
				system: buildNeutralitySystemPrompt(),
				tools: [SUBMIT_ISSUES_TOOL],
				tool_choice: { type: 'tool', name: 'submit_issues' },
				messages: [
					{
						role: 'user',
						content: `テーマ「${topicTitle}」について、専門知識を持たない一般の人々が最初に感じる素朴な疑問や関心事を5〜7件列挙してください。\n\n日常の感覚で「自分にも関係ある」「なんとなく気になる」と思える切り口に絞ってください。固有名詞（特定の企業・人名・政策名）や専門用語は使わないこと。各切り口を1〜2文で記述してください。`
					}
				]
			}),
			// 1b: ペルソナに基づく（専門的・立場特有の論点）
			client.messages.create({
				model: AI_MODELS.SONNET,
				max_tokens: MAX_TOKENS.FACILITATOR_CHAPTER_ISSUES,
				system: buildNeutralitySystemPrompt(),
				tools: [SUBMIT_ISSUES_TOOL],
				tool_choice: { type: 'tool', name: 'submit_issues' },
				messages: [
					{
						role: 'user',
						content: `テーマ「${topicTitle}」について、以下の参加者それぞれの立場・専門性・利害関係から生まれる具体的な論点や関心事を5〜8件列挙してください。\n\n参加者:\n${formatPersonas(personas)}\n\n各参加者が強い意見・懸念・利害を持つ側面を考慮し、参加者間で意見が対立しやすい切り口を優先してください。各切り口を1〜2文で記述してください。`
					}
				]
			})
		]);

		const generalIssuesBlock = generalIssuesResponse.content.find(
			(b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
		);
		const personaIssuesBlock = personaIssuesResponse.content.find(
			(b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
		);
		if (!generalIssuesBlock || !personaIssuesBlock) {
			return {
				ok: false,
				error: {
					code: 'AI_API_ERROR',
					message: 'No tool_use block in issues response',
					retryable: true
				}
			};
		}
		const { issues: generalIssues } = generalIssuesBlock.input as { issues: string[] };
		const { issues: personaIssues } = personaIssuesBlock.input as { issues: string[] };

		// Step 2: 章構造化（2種の切り口を区別して使用）
		const chaptersResponse = await client.messages.create({
			model: AI_MODELS.SONNET,
			max_tokens: MAX_TOKENS.FACILITATOR_CHAPTER_STRUCTURE,
			system: buildNeutralitySystemPrompt(),
			tools: [SUBMIT_CHAPTERS_TOOL],
			tool_choice: { type: 'tool', name: 'submit_chapters' },
			messages: [
				{
					role: 'user',
					content: `以下の2種類の切り口をもとに、討論の章立てを3〜6章に構成してください。\n\n【一般的な切り口（専門知識不要・日常感覚）】\n${generalIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\n\n【参加者固有の切り口（専門的・立場に基づく論点）】\n${personaIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\n\n各章に「章タイトル」と「その章で探求する具体的なフォーカス問い」を設定してください。\n\n【構成の原則・厳守事項】\n- 第1章は必ず「一般的な切り口」から選ぶこと。固有名詞・専門用語・業界用語を第1章のタイトルとフォーカス問いに含めてはならない。\n- 章を追うごとに「参加者固有の切り口」を取り込み、専門性・対立の鋭さを段階的に増す。固有名詞や専門用語は第3章以降から自然に導入してよい。\n- 「誰でも感覚的に答えられる入口 → 具体的な事例・比較 → 深いジレンマ・価値観の対立」の順に進むこと。`
				}
			]
		});

		const chaptersBlock = chaptersResponse.content.find(
			(b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
		);
		if (!chaptersBlock) {
			return {
				ok: false,
				error: {
					code: 'AI_API_ERROR',
					message: 'No tool_use block in chapters response',
					retryable: true
				}
			};
		}
		const { chapters } = chaptersBlock.input as {
			chapters: Array<{ title: string; focusQuestion: string }>;
		};

		const debateChapters: Chapter[] = chapters.map((c) => ({
			id: nanoid(),
			title: c.title,
			focusQuestion: c.focusQuestion
		}));

		return { ok: true, value: { chapters: debateChapters, generalIssues, personaIssues } };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};

/** セッション作成 → 章生成 → 保存を一貫して実行する */
export const planChapters = async (topicId: string): Promise<void> => {
	const topic = await getTopicById(topicId);
	if (!topic) throw new Error(`Topic not found: ${topicId}`);

	const personas = (await getPersonasByTopicId(topicId)).filter((p) => p.approved);

	const sessionRef = db().doc(`topics/${topicId}/sessions/0`);
	if (!(await sessionRef.get()).exists) {
		await sessionRef.set({ createdAt: Timestamp.now(), turns: [], postDebateComments: [] });
	}

	const result = await generateChapters(topic.title, personas);
	if (!result.ok) {
		const e = result.error;
		throw new Error('message' in e ? e.message : e.code);
	}

	const { chapters, generalIssues, personaIssues } = result.value;
	await db().doc(`topics/${topicId}/sessions/0`).update({
		chapters: chapters.map(({ id, title, focusQuestion }) => ({ id, title, focusQuestion })),
		currentChapterIndex: 0,
		chapterIssues: { general: generalIssues, persona: personaIssues }
	});
};
