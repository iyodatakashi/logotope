import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { generateText, jsonSchema } from 'ai';
import { getPipelineModel } from '../llm/models.js';
import { requireAuth } from '../utils/auth.js';
import { MAX_TOKENS } from '../config/ai.js';
import type { Stakeholder } from '../types/index.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'];

const STAKEHOLDER_TOOLS = {
  submit_stakeholders: {
    description: 'テーマに関する全利害関係者（直接・間接の当事者）を5件以上提出する',
    parameters: jsonSchema({
      type: 'object' as const,
      additionalProperties: false as const,
      properties: {
        stakeholders: {
          type: 'array' as const,
          minItems: 5,
          items: {
            type: 'object' as const,
            additionalProperties: false as const,
            properties: {
              role: { type: 'string' as const, description: '立場・役割の総称（ステークホルダーのグループ／カテゴリ。例: F1チーム関係者、地域住民、規制当局、ヘビーユーザー）。オーナー／メカニックのような個人の具体的な役職までは絞り込まない（具体化はペルソナ段階で行う）' },
              reason: { type: 'string' as const, description: 'この立場が当事者である理由' },
              mainInterests: { type: 'array' as const, items: { type: 'string' as const }, description: '主な関心事' },
              minorityLevel: { type: 'string' as const, enum: ['high', 'medium', 'low'], description: 'マイノリティ度' },
              engagementLevel: { type: 'string' as const, enum: ['high', 'medium', 'low'], description: 'テーマに対する専門・意識レベル。high=専門知識を持ち深く考えている当事者・専門家、medium=一定の知識と関心を持つ等身大の市民、low=専門知識は乏しいが生活者目線で自分なりの意見を持つ一般層（無関心・傍観者ではなく、議論には参加する立場）' },
            },
            required: ['role', 'reason', 'mainInterests', 'minorityLevel', 'engagementLevel'],
          },
        },
      },
      required: ['stakeholders'],
    }),
  },
} as const;

export const generateStakeholders = onCall({ timeoutSeconds: 300, secrets: SECRETS }, async (request) => {
  requireAuth(request);
  const { title } = request.data as { title: string };
  if (!title?.trim()) throw new HttpsError('invalid-argument', 'title is required');

  let result;
  try {
    result = await generateText({
      model: getPipelineModel('stakeholderAnalyzer'),
      maxTokens: MAX_TOKENS.STAKEHOLDER,
      tools: STAKEHOLDER_TOOLS,
      toolChoice: { type: 'tool', toolName: 'submit_stakeholders' } as const,
      messages: [{ role: 'user', content: `以下のテーマについて、直接・間接の全利害関係者を網羅的に分析してください。\n\nテーマ: ${title}\n\nマイノリティや少数意見の立場も忘れずに含めてください。\n\nまた、世の中は専門家や強い当事者ばかりではありません。専門・意識レベル（engagementLevel）には必ず幅を持たせ、専門知識は乏しいが生活者目線でテーマに向き合う一般層も含めてください。ただし各レベルの人数は固定せず、そのテーマで実際に当事者がどう分布しているかに応じて自然な構成にすること（レベルごとに均等な人数にしたり、機械的に何件ずつと割り当てたりしない）。low はあくまで議論に参加する立場であり、テーマに無関心な傍観者ではありません。専門家・当事者層（high）だけに偏らせないこと。` }],
    });
  } catch (err) {
    throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
  }

  const toolCall = result.toolCalls[0];
  if (!toolCall) throw new HttpsError('internal', 'No tool call in response');

  return { stakeholders: (toolCall.args as { stakeholders: Stakeholder[] }).stakeholders };
});
