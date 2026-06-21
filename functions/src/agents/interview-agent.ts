import { generateText, generateObject, jsonSchema, Output, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { tavily } from '@tavily/core';
import { getPipelineModel } from '../llm/models.js';
import type { Persona } from '../types/persona.types.js';
import type { TopicContext } from '../types/topic.types.js';

const MAX_SOURCE_CHARS = 3_000;

export type SearchResult = { title: string; url: string };
export type SearchSource = { query: string; summary: string; results: SearchResult[] };

export type InterviewOutput = {
	interviewRecord: string;
	initialBelief: string;
	sources: SearchSource[];
};

const interviewOutputSchema = z.object({
	researchItems: z.array(z.object({ query: z.string(), summary: z.string() })),
	interviewRecord: z.string(),
	initialBelief: z.string()
});

const evaluationSchema = z.object({
	sufficient: z.boolean(),
	gaps: z.array(z.string())
});

const buildTools = (searchLog: Array<{ query: string; results: SearchResult[] }>) => {
	const tavilyClient = tavily();

	return {
		web_search: {
			description:
				'ペルソナの立場・背景に関連する情報をウェブ検索する。当事者の体験談・証言・インタビュー・本音など一次情報を優先的に探す。',
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
					searchLog.push({
						query,
						results: res.results.map((r) => ({ title: r.title, url: r.url }))
					});
					return res.results.map((r) => `[${r.title}](${r.url})\n${r.content}`).join('\n\n');
				} catch (e) {
					return `検索失敗: ${e}`;
				}
			}
		},
		evaluate_research: {
			description:
				'これまでの調査内容を評価し、ペルソナのバックグラウンド形成に十分かどうかを判定する。一通り調査したら必ず呼ぶこと。不足があれば追加調査して再度呼ぶ。',
			inputSchema: jsonSchema({
				type: 'object' as const,
				additionalProperties: false as const,
				properties: {
					summary: {
						type: 'string' as const,
						description: 'これまでの調査で得た情報の要約'
					}
				},
				required: ['summary']
			}),
			execute: async ({ summary }: { summary: string }) => {
				try {
					const result = await generateObject({
						model: anthropic('claude-haiku-4-5-20251001'),
						schema: evaluationSchema,
						messages: [
							{
								role: 'user',
								content: `以下の調査結果が、ペルソナの初期信念構築に十分かどうか評価してください。

調査結果:
${summary}

評価基準（すべて満たす必要がある）:
- 当事者の具体的な体験・本音・感情が含まれているか
- テーマに対する現実的な懸念・期待・不安が含まれているか
- ペルソナの職業・生活に直結する具体的な事例があるか
- 一般論・統計だけでなく人間的なエピソードがあるか

sufficient: すべての基準を満たせばtrue
gaps: 不足している観点のリスト（十分なら空配列）`
							}
						]
					});
					if (result.object.sufficient) {
						return '【評価: 十分】調査は十分です。次のステップに進んでください。';
					}
					return `【評価: 不足】以下の観点で追加調査が必要です:\n${result.object.gaps.map((g) => `- ${g}`).join('\n')}`;
				} catch (e) {
					return `評価失敗: ${e}`;
				}
			}
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
	const searchLog: Array<{ query: string; results: SearchResult[] }> = [];
	const result = await generateText({
		model: getPipelineModel('personaInterview'),
		stopWhen: stepCountIs(20),
		tools: buildTools(searchLog),
		output: Output.object({ schema: interviewOutputSchema }),
		messages: [
			{
				role: 'user',
				content: `テーマ「${topicTitle}」について、以下のペルソナの取材を行い、初期信念を構築してください。${contextSection}

【ステップ1: ウェブリサーチ】
以下の手順で調査してください：
1. web_search を使って調査を開始する（複数クエリ可）
2. 一通り調査が終わったら evaluate_research を呼んで充足度を確認する
3. 不足があれば指摘された観点で web_search を追加実行し、再度 evaluate_research を呼ぶ
4. evaluate_research で「十分」と判定されたらステップ2へ進む

ステレオタイプや一般論ではなく、当事者の体験談・証言・インタビュー・本音を探してください。

【ステップ2: 仮想インタビュー】
リサーチで得た情報を踏まえ、このペルソナに記者がインタビューする形式で取材記録を作成してください。
生活・仕事への具体的な影響、不安・期待、価値観を深掘りし、1000字以上の質疑応答記録にまとめてください。

【ステップ3: 出力】
リサーチと取材が完了したら、以下の3項目を出力してください。
- researchItems: 実施した各検索クエリについて { query: 検索クエリ文字列, summary: 収集した情報の要点（2〜3文） } の配列
- interviewRecord: 仮想取材の質疑応答記録（1000字以上）
- initialBelief: 初期信念ドキュメント（Markdown形式。立場と根拠・核心的主張・懸念事項・価値観・妥協点・変化の可能性の6項目を含む）

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

	const { researchItems, interviewRecord, initialBelief } = result.output;
	const sources: SearchSource[] = searchLog.map((s) => ({
		...s,
		summary: researchItems.find((i) => i.query === s.query)?.summary ?? ''
	}));

	return { interviewRecord, initialBelief, sources };
};
