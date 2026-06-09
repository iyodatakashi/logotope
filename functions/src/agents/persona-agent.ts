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
  DebateChapter,
  Result,
  PipelineError,
} from '../types/index.js';

type ExperienceLevel = 'young' | 'mid' | 'veteran';
type AuthorityLevel = 'general' | 'mid' | 'high';

const VETERAN_KEYWORDS = ['ベテラン', 'シニア', '管理職', '教授', '博士', '専門家', '研究者'];
const YOUNG_KEYWORDS = ['新入', '学生', 'インターン', '若手', '研修'];
const HIGH_AUTHORITY_KEYWORDS = ['経営', '社長', 'CEO', '代表', '部長', '局長', '院長', '教授', '有識者', '専門家', '弁護士', '医師', '研究者'];
const MID_AUTHORITY_KEYWORDS = ['主任', '係長', '課長', 'マネージャー', '管理'];

function estimateExperienceLevel(age: number, occupation: string): ExperienceLevel {
  if (YOUNG_KEYWORDS.some(kw => occupation.includes(kw)) || age <= 30) return 'young';
  if (VETERAN_KEYWORDS.some(kw => occupation.includes(kw)) || age >= 55) return 'veteran';
  return 'mid';
}

function estimateAuthorityLevel(stakeholderRole: string): AuthorityLevel {
  if (HIGH_AUTHORITY_KEYWORDS.some(kw => stakeholderRole.includes(kw))) return 'high';
  if (MID_AUTHORITY_KEYWORDS.some(kw => stakeholderRole.includes(kw))) return 'mid';
  return 'general';
}

export function buildSpeechStyleGuide(persona: PersonaAttributes & { gender?: string }): string {
  const expLevel = estimateExperienceLevel(persona.age, persona.occupation);
  const authLevel = estimateAuthorityLevel(persona.stakeholderRole);
  const lines: string[] = [];

  lines.push('これは口語の対話であり、書き言葉（「〜だ」「〜である」「〜ではない」調）は使わない。');

  if (expLevel === 'young') {
    lines.push('「〜かな？」「そうなんですか？」「〜じゃないですか」など口語の疑問形を自然に用いる。');
    lines.push('経験が少ない若手として、断言より確認・質問を多く使う。');
  } else if (expLevel === 'veteran') {
    lines.push('豊富な経験を基に自信を持って話す（「〜ですよ」「そうじゃない」「〜じゃないですか」「実際にね〜」）。');
    lines.push('業界用語・専門語彙を自然に交え、経験談（「〜のとき実際に〜」）を活用する。');
  } else {
    lines.push('「〜ですね」「〜だと思います」など断言と確認のバランスを保つ口語で話す。');
    lines.push('具体的な事例を示しながら意見を述べる。');
  }

  if (authLevel === 'high') {
    lines.push('権威ある立場として自信を持って発言する。「〜ですよ」「そうじゃない」「〜じゃないかな」「〜というのはどう？」「それは間違いです」など口語で断言し、謙遜表現（「〜かもしれません」）は避ける。');
  } else if (authLevel === 'mid') {
    lines.push('組織内の立場を反映し、現場と管理側の視点を行き来しながら「〜ですね」「〜だと思います」で話す。');
  } else {
    lines.push('遠慮がちに発言し、「〜ではないかと思いますが」「〜なんじゃないですかね」などの表現を自然に使う。');
  }

  lines.push('画一的なビジネス敬語（「〜でございます」「〜存じます」）は避ける。');

  if (persona.gender) {
    lines.push(`${persona.gender}としての自然な語感を大切に、ただし性別による過度な役割固定は避ける。`);
  }

  return lines.join('\n');
}

function buildPersonaSystemPrompt(
  persona: PersonaAttributes & { gender?: string },
  interviewRecord: string,
  currentBelief: string
): string {
  const styleGuide = buildSpeechStyleGuide(persona);
  return `あなたは以下のペルソナとして討論に参加しています。このペルソナの視点・価値観・経験に忠実に発言してください。他のペルソナの内部状態（信念ドキュメントや取材レコード）は参照しないでください。

## 発言スタイルの厳守事項
${styleGuide}
- 発言は **reaction（相槌・短い反応）** か **full（意見・論点をしっかり述べる）** のどちらかで行う。会話の流れに応じて自然に使い分けること。演説禁止。
- 必ず直前の誰かの発言を受けて、その内容に具体的に反応する。
- **発言の冒頭で相手の名前を呼んではいけない**（「○○さんのおっしゃる通り」「○○さんが言ったように」などは禁止）。
- 自分の信念・立場に基づいて反論・疑問を呈することを恐れない。相手の意見に同意しない場合は、はっきりそう言う。同意一辺倒は不自然。

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

function buildTurnTool(styleGuide: string): Anthropic.Tool {
  const styleSummary = styleGuide.split('\n')[0];
  return {
    name: 'submit_turn',
    description: 'ペルソナとして討論の1ターン分の発言を提出する',
    input_schema: {
      type: 'object' as const,
      properties: {
        speechMode: {
          type: 'string',
          enum: ['reaction', 'full'],
          description: 'まずこれを決める。**デフォルトは reaction**（相槌・短い反応・一言同意など10〜25文字）。full を選ぶのは「新しい論点・根拠・具体例を初めて持ち出すとき」または「本格的に反論するとき」のみ。それ以外はすべて reaction。',
        },
        content: { type: 'string', description: `発言テキスト。reaction なら10〜25文字の短い反応のみ。full なら意見・根拠をしっかり述べる（最大200文字）。語り口: ${styleSummary}` },
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
            '返答を求める特定のペルソナのID。そのペルソナに直接質問する場合のみ指定する。反論・同意・感想など応答を強制しない発言では省略する',
        },
      },
      required: ['speechMode', 'content'],
    },
  };
}

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
    history: ConversationTurn[],
    currentChapter?: DebateChapter
  ): Promise<Result<AgentTurnResult, PipelineError>> {
    try {
      const recentHistory = history.slice(-20);
      const styleGuide = buildSpeechStyleGuide(persona);
      const chapterContext = currentChapter
        ? `\n\n【この章のフォーカス】「${currentChapter.title}」: ${currentChapter.focusQuestion}`
        : '';
      const userContent = `討論の現在の状況:\n\n${formatHistory(recentHistory)}${chapterContext}\n\n${persona.name}として発言してください。speechMode を自分で判断すること（reaction=短い反応10〜25文字 / full=意見・論点・根拠をしっかり述べる最大200文字）。冒頭で相手の名前を呼ぶことは禁止。信念に変化があれば beliefChangeType を指定。直接質問する場合のみ addressedToPersonaId を指定。`;
      const response = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.PERSONA_TURN,
        system: buildPersonaSystemPrompt(persona, interviewRecord, currentBelief),
        tools: [buildTurnTool(styleGuide)],
        tool_choice: { type: 'tool', name: 'submit_turn' },
        messages: [{ role: 'user', content: userContent }],
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
        speechMode,
        content,
        beliefChangeType,
        beliefChangeSummary,
        beliefChangeUpdatedBelief,
        addressedToPersonaId,
      } = toolBlock.input as {
        speechMode?: 'reaction' | 'full';
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

      return { ok: true, value: { content, speechMode, beliefChange, addressedToPersonaId } };
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
