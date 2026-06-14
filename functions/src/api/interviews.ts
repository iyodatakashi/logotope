import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { generateText, jsonSchema } from 'ai';
import { tavily } from '@tavily/core';
import { getPipelineModel } from '../llm/models.js';
import { requireAuth } from '../utils/auth.js';
import { MAX_TOKENS } from '../config/ai.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'];

interface PersonaInput {
  name: string;
  age: number;
  occupation: string;
  stakeholderRole: string;
  specificRole?: string;
  background: string;
  interests: string;
}

const buildTools = () => {
  const tavilyClient = tavily();

  return {
    web_search: {
      description: 'ペルソナの立場・背景に関連する情報をウェブ検索する。当事者の体験談・証言・インタビュー・本音など一次情報を優先的に探す。必要と判断した回数だけ呼び出してよい。',
      parameters: jsonSchema({
        type: 'object' as const,
        additionalProperties: false as const,
        properties: {
          query: { type: 'string' as const, description: '検索クエリ' },
          mode: {
            type: 'string' as const,
            enum: ['general', 'news'],
            description: 'general=体験談・実態調査、news=最新動向・政策・事件',
          },
        },
        required: ['query', 'mode'],
      }),
      execute: async ({ query, mode }: { query: string; mode: 'general' | 'news' }) => {
        try {
          const res = await tavilyClient.search(query, {
            maxResults: 5,
            ...(mode === 'news' ? { topic: 'news' } : {}),
          });
          if (res.results.length === 0) return '検索結果なし';
          return res.results.map(r => `[${r.title}]\n${r.content}`).join('\n\n');
        } catch (e) {
          return `検索失敗: ${e}`;
        }
      },
    },
    submit_research: {
      description: 'ウェブリサーチと仮想インタビューが完了したら呼び出す。リサーチサマリー・取材記録・初期信念ドキュメントを提出する。',
      parameters: jsonSchema({
        type: 'object' as const,
        additionalProperties: false as const,
        properties: {
          researchSummary: {
            type: 'string' as const,
            description: '実施した検索クエリと収集した主な情報のサマリー（500字程度）',
          },
          interviewRecord: {
            type: 'string' as const,
            description: 'ペルソナへの仮想取材の質疑応答記録（1000字以上推奨）。生活・仕事への具体的な影響、不安・期待、価値観を深掘りした内容にすること',
          },
          initialBelief: {
            type: 'string' as const,
            description: '初期信念ドキュメント（Markdown形式。以下の6項目を含むこと: 立場と根拠, 核心的主張, 懸念事項, 価値観, 妥協点, 変化の可能性）',
          },
        },
        required: ['researchSummary', 'interviewRecord', 'initialBelief'],
      }),
    },
  } as const;
};

export const runInterview = onCall({ timeoutSeconds: 300, secrets: SECRETS }, async (request) => {
  requireAuth(request);
  const { topicTitle, persona } = request.data as { topicTitle: string; persona: PersonaInput };
  if (!topicTitle?.trim()) throw new HttpsError('invalid-argument', 'topicTitle is required');
  if (!persona?.name) throw new HttpsError('invalid-argument', 'persona is required');

  let result;
  try {
    result = await generateText({
      model: getPipelineModel('personaInterview'),
      maxTokens: MAX_TOKENS.INTERVIEW,
      maxSteps: 10,
      tools: buildTools(),
      messages: [{
        role: 'user',
        content: `テーマ「${topicTitle}」について、以下のペルソナの取材を行い、初期信念を構築してください。

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
立場: ${persona.specificRole || persona.stakeholderRole}
背景: ${persona.background}
関心事: ${persona.interests}`,
      }],
    });
  } catch (err) {
    throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
  }

  const submitCall = result.toolCalls.find(c => c.toolName === 'submit_research');
  if (!submitCall) throw new HttpsError('internal', 'submit_research was not called');

  const { researchSummary, interviewRecord, initialBelief } = submitCall.args as {
    researchSummary: string;
    interviewRecord: string;
    initialBelief: string;
  };

  return { researchSummary, interviewRecord, initialBelief };
});
