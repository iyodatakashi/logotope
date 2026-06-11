import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { generateText, jsonSchema } from 'ai';
import { getPipelineModel } from '../llm/models.js';
import { requireAuth } from '../utils/auth.js';
import { MAX_TOKENS } from '../config/ai.js';
import type { Stakeholder } from '../types/index.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'];

const PERSONA_TOOLS = {
  submit_personas: {
    description: 'ステークホルダーリストの各立場に対応するペルソナを1体ずつ生成して提出する',
    parameters: jsonSchema({
      type: 'object' as const,
      additionalProperties: false as const,
      properties: {
        personas: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            additionalProperties: false as const,
            properties: {
              stakeholderRole: { type: 'string' as const, description: 'どの立場に対応するか' },
              name: { type: 'string' as const, description: '氏名' },
              nationality: { type: 'string' as const, description: '国籍・出身国' },
              age: { type: 'integer' as const, description: '年齢' },
              occupation: { type: 'string' as const, description: '職業' },
              background: { type: 'string' as const, description: '生活・社会的背景（200字以内）' },
              interests: { type: 'string' as const, description: '主な関心事・価値観（200字以内）' },
              stanceDirection: { type: 'string' as const, description: 'テーマへのスタンス方向' },
              llmType: {
                type: 'string' as const,
                enum: ['gemini', 'claude', 'gpt'],
                description: 'gemini=最新情報重視・SNS世論に敏感(記者・アナリスト・活動家等)、claude=学術・論理重視(研究者・教授等)、gpt=バランス型(一般市民・会社員等)',
              },
            },
            required: ['stakeholderRole', 'name', 'nationality', 'age', 'occupation', 'background', 'interests', 'stanceDirection', 'llmType'],
          },
        },
      },
      required: ['personas'],
    }),
  },
} as const;

export const generatePersonas = onCall({ timeoutSeconds: 300, secrets: SECRETS }, async (request) => {
  requireAuth(request);
  const { title, stakeholders } = request.data as { title: string; stakeholders: Stakeholder[] };
  if (!title?.trim()) throw new HttpsError('invalid-argument', 'title is required');
  if (!stakeholders?.length) throw new HttpsError('invalid-argument', 'stakeholders is required');

  const rolesDesc = stakeholders.map((s, i) => `${i + 1}. ${s.role}（${s.stanceDirection}）`).join('\n');

  let result;
  try {
    result = await generateText({
      model: getPipelineModel('personaGenerator'),
      maxTokens: MAX_TOKENS.PERSONA,
      tools: PERSONA_TOOLS,
      toolChoice: { type: 'tool', toolName: 'submit_personas' } as const,
      messages: [{
        role: 'user',
        content: `テーマ「${title}」について、以下の各立場を代表する具体的なペルソナを1体ずつ生成してください。\n\n立場リスト:\n${rolesDesc}`,
      }],
    });
  } catch (err) {
    throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
  }

  const toolCall = result.toolCalls[0];
  if (!toolCall) throw new HttpsError('internal', 'No tool call in response');

  return { personas: (toolCall.args as { personas: unknown[] }).personas };
});
