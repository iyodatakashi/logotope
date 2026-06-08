import Anthropic from '@anthropic-ai/sdk';
import { AI_MODELS, MAX_TOKENS } from '../config/ai.js';
import { formatHistory } from '../utils/conversation.js';
import type {
  ConversationTurn,
  PersonaAttributes,
  AgentTurnResult,
  BeliefChangeEvent,
  BeliefChangeType,
  PostDebateCommentResult,
  Result,
  PipelineError,
} from '../types/index.js';

function buildPersonaSystemPrompt(
  persona: PersonaAttributes,
  interviewRecord: string,
  currentBelief: string
): string {
  return `あなたは以下のペルソナとして討論に参加しています。このペルソナの視点・価値観・経験に忠実に発言してください。他のペルソナの内部状態（信念ドキュメントや取材レコード）は参照しないでください。

## 発言スタイルの厳守事項
- 1回の発言は**必ず2〜3文以内**に収める。長い演説は絶対に禁止。
- 必ず直前の誰かの発言を受けて、その内容に具体的に反応する。
- 「〜と思います」「〜ではないでしょうか」などの短い口語体で話す。
- 自分の立場や主張を一方的に述べるのではなく、相手の言葉に応じて対話する。

## ペルソナプロフィール
- 名前: ${persona.name}
- 年齢: ${persona.age}歳
- 職業: ${persona.occupation}
- 立場: ${persona.stakeholderRole}
- 背景: ${persona.background}
- 関心事: ${persona.interests}
- 主張方向: ${persona.stanceDirection}

## 事前取材レコード
${interviewRecord}

## 現在の信念ドキュメント
${currentBelief}`;
}

const TURN_TOOL: Anthropic.Tool = {
  name: 'submit_turn',
  description: 'ペルソナとして討論の1ターン分の発言を提出する',
  input_schema: {
    type: 'object' as const,
    properties: {
      content: { type: 'string', description: 'ペルソナの発言テキスト（2〜3文以内。直前の発言を受けた短い返答）' },
      beliefChangeType: {
        type: 'string',
        enum: ['opinion_change', 'partial_acceptance'],
        description:
          '信念変化タイプ: opinion_change=立場・結論が完全に変わる場合、partial_acceptance=他の意見の一部を受け入れる場合。変化なしの場合は省略する',
      },
      beliefChangeSummary: {
        type: 'string',
        description: '信念変化の理由・概要（beliefChangeTypeを指定した場合のみ記入）',
      },
      beliefChangeUpdatedBelief: {
        type: 'string',
        description: '変化後の信念ドキュメント（Markdown形式。beliefChangeTypeを指定した場合のみ記入）',
      },
      addressedToPersonaId: {
        type: 'string',
        description:
          '次に話してほしいペルソナのID。特定の参加者の発言に直接返答する場合に指定する。明確な宛先がない場合は省略する',
      },
    },
    required: ['content'],
  },
};

const POST_DEBATE_COMMENT_TOOL: Anthropic.Tool = {
  name: 'submit_post_debate_comment',
  description: 'ペルソナとして討論後の短いコメントを提出する（2〜4文）',
  input_schema: {
    type: 'object' as const,
    properties: {
      content: {
        type: 'string',
        description:
          '討論後コメント（2〜4文）: 他の参加者の意見を聞いてどう感じたか・印象に残った意見・自分の考えの変化を含める',
      },
    },
    required: ['content'],
  },
};

export class PersonaAgentService {
  private client: Anthropic;

  constructor(client = new Anthropic()) {
    this.client = client;
  }

  async generateTurn(
    persona: PersonaAttributes,
    currentBelief: string,
    interviewRecord: string,
    history: ConversationTurn[]
  ): Promise<Result<AgentTurnResult, PipelineError>> {
    try {
      const recentHistory = history.slice(-20);
      const response = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.PERSONA_TURN,
        system: buildPersonaSystemPrompt(persona, interviewRecord, currentBelief),
        tools: [TURN_TOOL],
        tool_choice: { type: 'tool', name: 'submit_turn' },
        messages: [{
          role: 'user',
          content: `討論の現在の状況:\n\n${formatHistory(recentHistory)}\n\n${persona.name}として、**直前の発言に2〜3文で短く返答してください**。演説や長い説明は禁止です。相手の言葉に具体的に反応してください。信念に変化があればbeliefChangeTypeを指定し、特定の参加者への返答であればaddressedToPersonaIdを指定してください。`,
        }],
      });

      const toolBlock = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (!toolBlock) {
        return {
          ok: false,
          error: { code: 'AI_API_ERROR', message: 'No tool_use block in response', retryable: true },
        };
      }

      const {
        content,
        beliefChangeType,
        beliefChangeSummary,
        beliefChangeUpdatedBelief,
        addressedToPersonaId,
      } = toolBlock.input as {
        content: string;
        beliefChangeType?: BeliefChangeType;
        beliefChangeSummary?: string;
        beliefChangeUpdatedBelief?: string;
        addressedToPersonaId?: string;
      };

      const beliefChange: BeliefChangeEvent | null = beliefChangeType
        ? {
            type: beliefChangeType,
            summary: beliefChangeSummary ?? '',
            updatedBelief: beliefChangeUpdatedBelief ?? '',
          }
        : null;

      return { ok: true, value: { content, beliefChange, addressedToPersonaId } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
    }
  }

  async generatePostDebateComment(
    persona: PersonaAttributes,
    finalBelief: string,
    history: ConversationTurn[]
  ): Promise<Result<PostDebateCommentResult, PipelineError>> {
    try {
      const response = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.PERSONA_POST_DEBATE,
        system: buildPersonaSystemPrompt(persona, '', finalBelief),
        tools: [POST_DEBATE_COMMENT_TOOL],
        tool_choice: { type: 'tool', name: 'submit_post_debate_comment' },
        messages: [{
          role: 'user',
          content: `以下の討論全体を踏まえて、${persona.name}として討論後のコメントを2〜4文で述べてください。他の参加者の意見を聞いてどう感じたか、印象に残った意見、自分の考えの変化を含めてください。\n\n討論全体:\n${formatHistory(history)}`,
        }],
      });

      const toolBlock = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (!toolBlock) {
        return {
          ok: false,
          error: { code: 'AI_API_ERROR', message: 'No tool_use block in response', retryable: true },
        };
      }

      const { content } = toolBlock.input as { content: string };
      return { ok: true, value: { personaId: persona.id, content } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
    }
  }
}
