import Anthropic from '@anthropic-ai/sdk';
import * as repo from '../db/repository.js';
import { AI_MODELS, MAX_TOKENS } from '../config/ai.js';
import type { PersonaAttributes, InterviewResult, Result, PipelineError } from '../types/index.js';

const INTERVIEW_TOOL: Anthropic.Tool = {
  name: 'submit_interview',
  description: 'ペルソナへの取材記録と初期信念ドキュメントを提出する',
  input_schema: {
    type: 'object' as const,
    properties: {
      interviewRecord: { type: 'string', description: 'インタビューの質疑応答記録（1000字以上推奨）' },
      initialBelief: {
        type: 'string',
        description: '初期信念ドキュメント（Markdown形式。以下の6項目を含むこと: 立場と根拠, 核心的主張, 懸念事項, 価値観, 妥協点, 変化の可能性）',
      },
    },
    required: ['interviewRecord', 'initialBelief'],
  },
};

export class InterviewerService {
  private client: Anthropic;

  constructor(client = new Anthropic()) {
    this.client = client;
  }

  private async interviewOne(
    topicId: string,
    topicTitle: string,
    persona: PersonaAttributes
  ): Promise<InterviewResult> {
    console.log(`[interview] start: ${persona.id} (${persona.name})`);
    await repo.startPersonaInterview(topicId, persona.id);
    const response = await this.client.messages.create({
      model: AI_MODELS.OPUS,
      max_tokens: MAX_TOKENS.INTERVIEW,
      tools: [INTERVIEW_TOOL],
      tool_choice: { type: 'tool', name: 'submit_interview' },
      messages: [{
        role: 'user',
        content: `テーマ「${topicTitle}」について、以下のペルソナに取材してください。生活・仕事への具体的な影響、不安・期待、価値観を深掘りし、初期信念ドキュメントを生成してください。\n\n氏名: ${persona.name}\n年齢: ${persona.age}歳\n職業: ${persona.occupation}\n立場: ${persona.stakeholderRole}\n背景: ${persona.background}\n関心事: ${persona.interests}`,
      }],
    });
    console.log(`[interview] claude done: ${persona.id}`);

    const toolBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolBlock) throw new Error('No tool_use block in response');

    const { interviewRecord, initialBelief } = toolBlock.input as { interviewRecord: string; initialBelief: string };

    await repo.createCompletedPersonaInterview(topicId, persona.id, interviewRecord);
    console.log(`[interview] firestore done: ${persona.id}`);
    await repo.createPersonaBelief({ topicId, personaId: persona.id, version: 0, content: initialBelief });

    return { personaId: persona.id, interviewRecord, initialBelief, status: 'completed' };
  }

  async runInterview(
    topicId: string,
    topicTitle: string,
    persona: PersonaAttributes
  ): Promise<Result<InterviewResult, PipelineError>> {
    try {
      const result = await this.interviewOne(topicId, topicTitle, persona);
      return { ok: true, value: result };
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      await repo.createErrorPersonaInterview(topicId, persona.id, errorMessage).catch(() => undefined);
      return { ok: false, error: { code: 'AI_API_ERROR', message: errorMessage, retryable: true } };
    }
  }
}
