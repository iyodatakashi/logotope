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
              role: { type: 'string' as const, description: '立場・役割名' },
              reason: { type: 'string' as const, description: 'この立場が当事者である理由' },
              mainInterests: { type: 'array' as const, items: { type: 'string' as const }, description: '主な関心事' },
              stanceDirection: { type: 'string' as const, enum: ['pro', 'against', 'conditional', 'neutral'] },
              minorityLevel: { type: 'string' as const, enum: ['high', 'medium', 'low'], description: 'マイノリティ度' },
            },
            required: ['role', 'reason', 'mainInterests', 'stanceDirection', 'minorityLevel'],
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
      messages: [{ role: 'user', content: `以下のテーマについて、直接・間接の全利害関係者を網羅的に分析してください。\n\nテーマ: ${title}\n\nマイノリティや少数意見の立場も忘れずに含めてください。` }],
    });
  } catch (err) {
    throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
  }

  const toolCall = result.toolCalls[0];
  if (!toolCall) throw new HttpsError('internal', 'No tool call in response');

  return { stakeholders: (toolCall.args as { stakeholders: Stakeholder[] }).stakeholders };
});
