import Anthropic from '@anthropic-ai/sdk';
import * as repo from '../db/repository.js';
import { AI_MODELS, MAX_TOKENS } from '../config/ai.js';
import type { Stakeholder, PersonaAttributes, Result, PipelineError } from '../types/index.js';

const PERSONA_TOOL: Anthropic.Tool = {
  name: 'submit_personas',
  description: 'ステークホルダーリストの各立場に対応するペルソナを1体ずつ生成して提出する',
  input_schema: {
    type: 'object' as const,
    properties: {
      personas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            stakeholderRole: { type: 'string', description: 'どの立場に対応するか' },
            name: { type: 'string', description: '氏名（テーマ・ステークホルダーの国際的文脈に合った名前。グローバルなテーマでは多国籍の名前を使う）' },
            nationality: { type: 'string', description: '国籍・出身国（例: 日本、イギリス、ブラジル）' },
            age: { type: 'integer', description: '年齢' },
            occupation: { type: 'string', description: '職業' },
            background: { type: 'string', description: '生活・社会的背景（200字以内）' },
            interests: { type: 'string', description: '主な関心事・価値観（200字以内）' },
            stanceDirection: { type: 'string', description: 'テーマへのスタンス方向' },
          },
          required: ['stakeholderRole', 'name', 'nationality', 'age', 'occupation', 'background', 'interests', 'stanceDirection'],
        },
      },
    },
    required: ['personas'],
  },
};

export class PersonaGeneratorService {
  private client: Anthropic;

  constructor(client = new Anthropic()) {
    this.client = client;
  }

  async generate(
    topicId: string,
    topicTitle: string,
    stakeholders: Stakeholder[]
  ): Promise<Result<PersonaAttributes[], PipelineError>> {
    if (stakeholders.length === 0) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'stakeholders must not be empty' } };
    }

    const rolesDesc = stakeholders.map((s, i) => `${i + 1}. ${s.role}（${s.stanceDirection}）`).join('\n');

    const response = await this.client.messages.create({
      model: AI_MODELS.OPUS,
      max_tokens: MAX_TOKENS.PERSONA,
      tools: [PERSONA_TOOL],
      tool_choice: { type: 'tool', name: 'submit_personas' },
      messages: [{
        role: 'user',
        content: `テーマ「${topicTitle}」について、以下の各立場を代表する具体的なペルソナを1体ずつ生成してください。\n\n【命名のルール】\n- 基本的には日本人のペルソナとして生成すること。ただしテーマが明らかに海外を舞台とする（例: F1、海外スポーツ、国際政治）場合は、そのテーマに合った国籍の人物を含めること\n- 佐藤・田中・鈴木など超頻出姓、陽菜・蓮・葵など近年多用される名前への偏りを避けること\n- 日本人名は地域性（東北・関西・九州など）や年代感（昭和・平成・令和の命名傾向の違い）をペルソナの年齢・背景に合わせて反映させること\n- 外国人ペルソナを含める場合はその国籍の実際の名前の傾向を反映させ、表記はカタカナにすること（例: ルイス・ハミルトン、カルロス・サインツ）\n- 年齢層・職業・社会的背景の多様性を確保すること\n\n立場リスト:\n${rolesDesc}`,
      }],
    });

    const toolBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolBlock) {
      return { ok: false, error: { code: 'AI_API_ERROR', message: 'No tool_use block in response', retryable: true } };
    }

    const { personas } = toolBlock.input as { personas: Omit<PersonaAttributes, 'id'>[] };

    const saved: PersonaAttributes[] = [];
    for (let i = 0; i < personas.length; i++) {
      const p = personas[i];
      const { id } = await repo.createPersonaProfile({
        topicId,
        stakeholderRole: p.stakeholderRole,
        name: p.name,
        nationality: p.nationality,
        age: p.age,
        occupation: p.occupation,
        background: p.background,
        interests: p.interests,
        stanceDirection: p.stanceDirection,
        sortOrder: i,
      });
      saved.push({ id, ...p });
    }

    return { ok: true, value: saved };
  }
}
