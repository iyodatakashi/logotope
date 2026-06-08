import Anthropic from '@anthropic-ai/sdk';
import { AI_MODELS, MAX_TOKENS } from '../config/ai.js';
import { formatHistory } from '../utils/conversation.js';
import type {
  ConversationTurn,
  PersonaAttributes,
  FacilitatorOpeningResult,
  FacilitatorIntervention,
  Result,
  PipelineError,
} from '../types/index.js';

const NEUTRALITY_SYSTEM_PROMPT =
  'あなたはテレビ討論番組のプロの司会者です。特定の立場への誘導は禁止しますが、議論を具体的な論点に絞り込んで進行するのがあなたの役割です。' +
  '「建設的な議論を」「様々な視点から」のような抽象的な言葉は使わない。' +
  '常に「〜についてはどうですか？」「〜という点で○○さんはどう思いますか？」のように具体的な問いかけで誘導する。' +
  '発言は2〜3文以内。演説禁止。';

const OPENING_TOOL: Anthropic.Tool = {
  name: 'submit_opening',
  description: '討論の冒頭発言と最初に発言させるペルソナIDを提出する',
  input_schema: {
    type: 'object' as const,
    properties: {
      content: { type: 'string', description: 'ファシリテーターの冒頭発言テキスト' },
      firstPersonaId: { type: 'string', description: '最初に発言させるペルソナのID' },
    },
    required: ['content', 'firstPersonaId'],
  },
};

const SELECT_SPEAKER_TOOL: Anthropic.Tool = {
  name: 'select_speaker',
  description: '次に発言すべきペルソナのIDを選択する（発言は生成しない。サイレントルーティングのみ）',
  input_schema: {
    type: 'object' as const,
    properties: {
      personaId: { type: 'string', description: '次に発言させるペルソナのID' },
    },
    required: ['personaId'],
  },
};

const INTERVENTION_TOOL: Anthropic.Tool = {
  name: 'evaluate_intervention',
  description: 'ファシリテーターとして可視介入が必要か判断し、必要な場合のみ介入発言を生成する',
  input_schema: {
    type: 'object' as const,
    properties: {
      shouldIntervene: { type: 'boolean', description: '介入が必要かどうか' },
      type: {
        type: 'string',
        enum: ['topic_shift', 'invite', 'close'],
        description: '介入タイプ。shouldIntervene=trueの場合のみ指定',
      },
      content: {
        type: 'string',
        description: 'ファシリテーターの介入発言テキスト。shouldIntervene=trueの場合のみ指定',
      },
      targetPersonaId: {
        type: 'string',
        description: '介入対象のペルソナID。invite/topic_shiftの場合に指定',
      },
    },
    required: ['shouldIntervene'],
  },
};

const CLOSING_TOOL: Anthropic.Tool = {
  name: 'submit_closing',
  description: '討論のクロージング発言を提出する',
  input_schema: {
    type: 'object' as const,
    properties: {
      content: { type: 'string', description: 'ファシリテーターのクロージング発言テキスト' },
    },
    required: ['content'],
  },
};

function formatPersonas(personas: PersonaAttributes[]): string {
  return personas
    .map(p => `- ID: ${p.id}, 名前: ${p.name}, 立場: ${p.stakeholderRole}, 主張方向: ${p.stanceDirection}`)
    .join('\n');
}

export class FacilitatorAgentService {
  private client: Anthropic;

  constructor(client = new Anthropic()) {
    this.client = client;
  }

  async generateOpening(
    topicTitle: string,
    personas: PersonaAttributes[]
  ): Promise<Result<FacilitatorOpeningResult, PipelineError>> {
    try {
      const response = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.FACILITATOR_OPENING,
        system: NEUTRALITY_SYSTEM_PROMPT,
        tools: [OPENING_TOOL],
        tool_choice: { type: 'tool', name: 'submit_opening' },
        messages: [{
          role: 'user',
          content: `テーマ「${topicTitle}」の討論を開始してください。\n\n参加者:\n${formatPersonas(personas)}\n\n冒頭発言（2〜3文）の構成：\n1. このテーマで最も対立しそうな具体的な論点を一つ選んで問いかける（例：「まず〇〇という点について伺いたいのですが」）\n2. 最初の発言者にその問いを向ける\n\n「議論を始めましょう」などの抽象的な言葉は禁止。必ず具体的な問いで始める。firstPersonaIdには必ず上記リストのIDを使用してください。`,
        }],
      });

      const toolBlock = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (!toolBlock) {
        return { ok: false, error: { code: 'AI_API_ERROR', message: 'No tool_use block in response', retryable: true } };
      }

      const { content, firstPersonaId } = toolBlock.input as FacilitatorOpeningResult;
      return { ok: true, value: { content, firstPersonaId } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
    }
  }

  async selectNextSpeaker(
    history: ConversationTurn[],
    personas: PersonaAttributes[],
    silenceMap: Map<string, number>
  ): Promise<Result<string, PipelineError>> {
    try {
      const silenceInfo = Array.from(silenceMap.entries())
        .map(([id, count]) => {
          const name = personas.find(p => p.id === id)?.name ?? id;
          return `${name}: ${count}ターン沈黙`;
        })
        .join(', ');

      const recentHistory = history.slice(-10);
      const response = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.FACILITATOR_SELECT,
        system: NEUTRALITY_SYSTEM_PROMPT,
        tools: [SELECT_SPEAKER_TOOL],
        tool_choice: { type: 'tool', name: 'select_speaker' },
        messages: [{
          role: 'user',
          content: `直前の発言に最も応答しそうなペルソナを1名選んでください。\n\n会話履歴（最新${recentHistory.length}件）:\n${formatHistory(recentHistory)}\n\n参加者:\n${formatPersonas(personas)}\n\n沈黙状況: ${silenceInfo || 'なし'}`,
        }],
      });

      const toolBlock = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (!toolBlock) {
        return { ok: false, error: { code: 'AI_API_ERROR', message: 'No tool_use block in response', retryable: true } };
      }

      const { personaId } = toolBlock.input as { personaId: string };
      return { ok: true, value: personaId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
    }
  }

  async evaluateIntervention(
    history: ConversationTurn[],
    personas: PersonaAttributes[]
  ): Promise<Result<FacilitatorIntervention, PipelineError>> {
    try {
      const response = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.FACILITATOR_INTERVENTION,
        system: NEUTRALITY_SYSTEM_PROMPT,
        tools: [INTERVENTION_TOOL],
        tool_choice: { type: 'tool', name: 'evaluate_intervention' },
        messages: [{
          role: 'user',
          content: `現在の討論を評価し、司会として介入すべきか判断してください。\n\n会話履歴:\n${formatHistory(history.slice(-20))}\n\n参加者:\n${formatPersonas(personas)}\n\n介入基準：\n- 同じ論点を繰り返している → topic_shift（新しい具体的な問いを立てて転換）\n- 発言していない参加者がいる → invite（その人に具体的な問いを向ける）\n- 議論が十分に深まった → close\n- まだ活発に議論中 → shouldIntervene=false\n\ntopic_shiftやinviteの場合、contentは必ず「〜についてはどうですか？」のような具体的な問いかけにする。`,
        }],
      });

      const toolBlock = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (!toolBlock) {
        return { ok: false, error: { code: 'AI_API_ERROR', message: 'No tool_use block in response', retryable: true } };
      }

      const raw = toolBlock.input as {
        shouldIntervene: boolean;
        type?: 'topic_shift' | 'invite' | 'close';
        content?: string;
        targetPersonaId?: string;
      };

      const intervention: FacilitatorIntervention = { shouldIntervene: raw.shouldIntervene };
      if (raw.shouldIntervene) {
        intervention.type = raw.type;
        intervention.content = raw.content;
        intervention.targetPersonaId = raw.targetPersonaId;
      }

      return { ok: true, value: intervention };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
    }
  }

  async generateClosing(
    history: ConversationTurn[],
    finalBeliefs: Map<string, string>
  ): Promise<Result<string, PipelineError>> {
    try {
      const beliefsSummary = Array.from(finalBeliefs.entries())
        .map(([id, belief]) => `ペルソナ ${id}:\n${belief}`)
        .join('\n\n');

      const response = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.FACILITATOR_CLOSING,
        system: NEUTRALITY_SYSTEM_PROMPT,
        tools: [CLOSING_TOOL],
        tool_choice: { type: 'tool', name: 'submit_closing' },
        messages: [{
          role: 'user',
          content: `討論が終了しました。クロージング発言を3〜4文で作成してください（簡潔な締め括りのみ。長い総括は不要）。\n\n会話全体:\n${formatHistory(history)}\n\n各参加者の最終信念:\n${beliefsSummary}`,
        }],
      });

      const toolBlock = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (!toolBlock) {
        return { ok: false, error: { code: 'AI_API_ERROR', message: 'No tool_use block in response', retryable: true } };
      }

      const { content } = toolBlock.input as { content: string };
      return { ok: true, value: content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
    }
  }
}
