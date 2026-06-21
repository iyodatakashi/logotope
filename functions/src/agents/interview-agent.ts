import { generateText, jsonSchema, stepCountIs } from 'ai';
import { tavily } from '@tavily/core';
import { getPipelineModel } from '../llm/models.js';
import type { Persona } from '../types/persona.types.js';
import type { TopicContext } from '../types/topic.types.js';

const MAX_SOURCE_CHARS = 3_000;

export type InterviewOutput = {
	researchSummary: string;
	interviewRecord: string;
	initialBelief: string;
};

const buildTools = () => {
	const tavilyClient = tavily();

	return {
		web_search: {
			description:
				'ペルソナの立場・背景に関連する情報をウェブ検索する。当事者の体験談・証言・インタビュー・本音など一次情報を優先的に探す。必要と判断した回数だけ呼び出してよい。',
			inputSchema: jsonSchema({
				type: 'object' as const,
				additionalProperties: false as const,
				properties: {
					query: { type: 'string' as const, description: '検索クエリ' },
					mode: {
						type: 'string' as const,
						enum: ['general', 'news'],
						description: 'general=体験談・実態調査、news=最新動向・政策・事件'
					}
				},
				required: ['query', 'mode']
			}),
			execute: async ({ query, mode }: { query: string; mode: 'general' | 'news' }) => {
				try {
					const res = await tavilyClient.search(query, {
						maxResults: 5,
						...(mode === 'news' ? { topic: 'news' } : {})
					});
					if (res.results.length === 0) return '検索結果なし';
					return res.results.map((r) => `[${r.title}]\n${r.content}`).join('\n\n');
				} catch (e) {
					return `検索失敗: ${e}`;
				}
			}
		},
		submit_research: {
			description:
				'ウェブリサーチと仮想インタビューが完了したら呼び出す。リサーチサマリー・取材記録・初期信念ドキュメントを提出する。',
			inputSchema: jsonSchema({
				type: 'object' as const,
				additionalProperties: false as const,
				properties: {
					researchSummary: {
						type: 'string' as const,
						description: '実施した検索クエリと収集した主な情報のサマリー（500字程度）'
					},
					interviewRecord: {
						type: 'string' as const,
						description:
							'ペルソナへの仮想取材の質疑応答記録（1000字以上推奨）。生活・仕事への具体的な影響、不安・期待、価値観を深掘りした内容にすること'
					},
					initialBelief: {
						type: 'string' as const,
						description:
							'初期信念ドキュメント（Markdown形式。以下の6項目を含むこと: 立場と根拠, 核心的主張, 懸念事項, 価値観, 妥協点, 変化の可能性）'
					}
				},
				required: ['researchSummary', 'interviewRecord', 'initialBelief']
			})
		}
	} as const;
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
	return parts.join('\n');
};

export const runInterview = async (
	topicTitle: string,
	persona: Persona,
	topicContext?: TopicContext
): Promise<InterviewOutput> => {
	const contextSection = buildTopicContextSection(topicContext);
	const result = await generateText({
		model: getPipelineModel('personaInterview'),
		stopWhen: stepCountIs(10),
		tools: buildTools(),
		messages: [
			{
				role: 'user',
				content: `テーマ「${topicTitle}」について、以下のペルソナの取材を行い、初期信念を構築してください。${contextSection}

【ステップ1: ウェブリサーチ】
まず web_search ツールを使って、このペルソナの立場に立つ実在の人々が実際にどんなことを考え、感じ、経験しているかを調査してください。
ステレオタイプや一般論ではなく、当事者の体験談・証言・インタビュー・本音を探してください。

【ステップ2: 仮想インタビュー】
リサーチで得た情報を踏まえ、このペルソナに記者がインタビューする形式で取材記録を作成してください。
生活・仕事への具体的な影響、不安・期待、価値観を深掘りし、1000字以上の質疑応答記録にまとめてください。

【ステップ3: 提出】
十分な情報が集まったら submit_research を呼び出してください。

【ペルソナ情報】
氏名: ${persona.name}
年齢: ${persona.age}歳
職業: ${persona.occupation}
立場: ${persona.specificRole}
背景: ${persona.background}
関心事: ${persona.interests}`
			}
		]
	});

	const submitCall = result.toolCalls.find((c) => c.toolName === 'submit_research');
	if (!submitCall) throw new Error('submit_research was not called');

	return submitCall.input as InterviewOutput;
};
