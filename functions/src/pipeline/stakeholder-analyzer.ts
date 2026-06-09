import Anthropic from '@anthropic-ai/sdk';
import * as repo from '../db/repository.js';
import { ProgressTrackerService } from './progress-tracker.js';
import { AI_MODELS, MAX_TOKENS } from '../config/ai.js';
import type { Stakeholder, Result, PipelineError } from '../types/index.js';

const STAKEHOLDER_TOOL: Anthropic.Tool = {
  name: 'submit_stakeholders',
  description: 'テーマに関する全利害関係者（直接・間接の当事者）を5件以上提出する',
  input_schema: {
    type: 'object' as const,
    properties: {
      stakeholders: {
        type: 'array',
        minItems: 5,
        items: {
          type: 'object',
          properties: {
            role: { type: 'string', description: '立場・役割名' },
            reason: { type: 'string', description: 'この立場が当事者である理由' },
            mainInterests: { type: 'array', items: { type: 'string' }, description: '主な関心事' },
            stanceDirection: { type: 'string', enum: ['pro', 'against', 'conditional', 'neutral'] },
            minorityLevel: { type: 'string', enum: ['high', 'medium', 'low'], description: 'マイノリティ度' },
          },
          required: ['role', 'reason', 'mainInterests', 'stanceDirection', 'minorityLevel'],
        },
      },
    },
    required: ['stakeholders'],
  },
};

export class StakeholderAnalyzerService {
  private client: Anthropic;
  private tracker: ProgressTrackerService;

  constructor(tracker = new ProgressTrackerService(), client = new Anthropic()) {
    this.tracker = tracker;
    this.client = client;
  }

  async analyze(topicId: string, title: string): Promise<Result<Stakeholder[], PipelineError>> {
    await this.tracker.updateStatus(topicId, 'surveying', 'ステークホルダー分析中...').catch(() => undefined);

    const response = await this.client.messages.create({
      model: AI_MODELS.OPUS,
      max_tokens: MAX_TOKENS.STAKEHOLDER,
      tools: [STAKEHOLDER_TOOL],
      tool_choice: { type: 'tool', name: 'submit_stakeholders' },
      messages: [{
        role: 'user',
        content: `以下のテーマについて、直接・間接の全利害関係者を網羅的に分析してください。\n\nテーマ: ${title}\n\nマイノリティや少数意見の立場も忘れずに含めてください。`,
      }],
    });

    const toolBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolBlock) {
      return { ok: false, error: { code: 'AI_API_ERROR', message: 'No tool_use block in response', retryable: true } };
    }

    const { stakeholders } = toolBlock.input as { stakeholders: Stakeholder[] };

    await repo.createStakeholderMap(topicId, JSON.stringify({ items: stakeholders }));

    return { ok: true, value: stakeholders };
  }
}
