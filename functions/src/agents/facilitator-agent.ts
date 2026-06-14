import Anthropic from '@anthropic-ai/sdk';
import { AI_MODELS, MAX_TOKENS } from '../config/ai.js';
import { formatHistory } from '../utils/conversation.js';
import type { DebateTurn } from '../db/repository.js';
import type {
  PersonaAttributes,
  FacilitatorOpeningResult,
  FacilitatorIntervention,
  DebateChapter,
  Result,
  PipelineError,
} from '../types/index.js';

function currentDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function buildNeutralitySystemPrompt(): string {
  return (
    `本日は ${currentDateString()} です。時事的な話題に言及する際はこの日付を基準にしてください。` +
    'あなたはテレビ討論番組のプロの司会者です。特定の立場への誘導は禁止しますが、議論を具体的な論点に絞り込んで進行するのがあなたの役割です。' +
    '「建設的な議論を」「様々な視点から」のような抽象的な言葉は使わない。' +
    '常に「〜についてはどうですか？」「〜という点で○○さんはどう思いますか？」のように具体的な問いかけで誘導する。' +
    '発言は2〜3文以内。演説禁止。'
  );
}

// 先に指名先（firstPersonaId）を確定させてから content を書かせる（呼びかけと ID の不一致防止）
const OPENING_TOOL: Anthropic.Tool = {
  name: 'submit_opening',
  description: '最初に発言させるペルソナを決めてから、討論の冒頭発言を提出する',
  input_schema: {
    type: 'object' as const,
    properties: {
      firstPersonaId: { type: 'string', description: '最初に発言させるペルソナのID（参加者リストのIDをそのまま指定）。先にここで指名先を確定させてから content を書くこと' },
      content: { type: 'string', description: 'ファシリテーターの冒頭発言テキスト。firstPersonaId の参加者に名前で呼びかけて問いを向ける' },
    },
    required: ['firstPersonaId', 'content'],
  },
};

// プロパティの定義順 = LLM の生成順。先に指名先（targetPersonaId）を確定させてから
// content を書かせることで、文中の呼びかけと指名 ID の不一致・ID 漏れを防ぐ
const INTERVENTION_TOOL: Anthropic.Tool = {
  name: 'evaluate_intervention',
  description: 'ファシリテーターとして可視介入が必要か判断し、必要な場合のみ介入発言を生成する',
  input_schema: {
    type: 'object' as const,
    properties: {
      shouldIntervene: { type: 'boolean', description: '介入が必要かどうか' },
      type: {
        type: 'string',
        enum: ['topic_shift', 'invite'],
        description: '介入タイプ。shouldIntervene=trueの場合のみ指定',
      },
      targetPersonaId: {
        type: 'string',
        description: '問いかけを向ける参加者のID。参加者リストに記載されたIDをそのまま指定する（名前ではなくID）。inviteの場合は必須。topic_shiftでも特定の参加者に問いを向ける場合は指定する。先にここで指名先を確定させてから content を書くこと',
      },
      content: {
        type: 'string',
        description: 'ファシリテーターの介入発言テキスト。targetPersonaIdを指定した場合は、その参加者に「○○さん、〜についてはどうですか？」のように必ず名前で呼びかける。shouldIntervene=trueの場合のみ指定',
      },
    },
    required: ['shouldIntervene'],
  },
};

const SUBMIT_ISSUES_TOOL: Anthropic.Tool = {
  name: 'submit_issues',
  description: '討論テーマに関する多様な切り口をフラットに列挙する',
  input_schema: {
    type: 'object' as const,
    properties: {
      issues: {
        type: 'array',
        items: { type: 'string' },
        description: '7〜10件の切り口（賛否・問題提起に偏らず、このテーマに関して人々が関心を持つ様々な側面を網羅的に列挙。各切り口を1〜2文で記述）',
      },
    },
    required: ['issues'],
  },
};

const SUBMIT_CHAPTERS_TOOL: Anthropic.Tool = {
  name: 'submit_chapters',
  description: '列挙した切り口をもとに討論の章立てを構成する（目安3〜6章）',
  input_schema: {
    type: 'object' as const,
    properties: {
      chapters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '章タイトル' },
            focusQuestion: { type: 'string', description: '討論フォーカス問い' },
          },
          required: ['title', 'focusQuestion'],
        },
      },
    },
    required: ['chapters'],
  },
};

const GENERATE_CHAPTER_TRANSITION_TOOL: Anthropic.Tool = {
  name: 'generate_chapter_transition',
  description: '章の遷移発言または最終章のまとめ発言を生成する',
  input_schema: {
    type: 'object' as const,
    properties: {
      content: { type: 'string', description: 'ファシリテーターの遷移発言テキスト' },
    },
    required: ['content'],
  },
};

// 先に指名先（firstPersonaId）を確定させてから content を書かせる（呼びかけと ID の不一致防止）
const CHAPTER_INTRO_TOOL: Anthropic.Tool = {
  name: 'submit_chapter_intro',
  description: '次の章で最初に発言させるペルソナを決めてから、章の導入発言を提出する',
  input_schema: {
    type: 'object' as const,
    properties: {
      firstPersonaId: { type: 'string', description: '最初に発言させるペルソナのID（参加者リストのIDをそのまま指定）。先にここで指名先を確定させてから content を書くこと' },
      content: { type: 'string', description: '章の導入発言テキスト。firstPersonaId の参加者に名前で呼びかけて問いを向ける' },
    },
    required: ['firstPersonaId', 'content'],
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
    .map(p => `- ID: ${p.id}, 名前: ${p.name}, 立場: ${p.specificRole || p.stakeholderRole}, 主張方向: ${p.stanceDirection}`)
    .join('\n');
}

export class FacilitatorAgentService {
  private client: Anthropic;

  constructor(client = new Anthropic()) {
    this.client = client;
  }

  async generateOpening(
    topicTitle: string,
    personas: PersonaAttributes[],
    firstChapter?: DebateChapter
  ): Promise<Result<FacilitatorOpeningResult, PipelineError>> {
    try {
      const chapterContext = firstChapter
        ? `\n\n第1章「${firstChapter.title}」のフォーカス: ${firstChapter.focusQuestion}`
        : '';
      const response = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.FACILITATOR_OPENING,
        system: buildNeutralitySystemPrompt(),
        tools: [OPENING_TOOL],
        tool_choice: { type: 'tool', name: 'submit_opening' },
        messages: [{
          role: 'user',
          content: `テーマ「${topicTitle}」の討論を開始してください。\n\n参加者:\n${formatPersonas(personas)}${chapterContext}\n\n冒頭発言（2〜3文）の構成：\n1. 第1章のフォーカス問いの趣旨に沿って、「このテーマに詳しくない人でも感覚的に答えられる」オープンな問いかけをする。固有名詞（特定の映像作品・企業名・人名・統計）や専門用語を使わないこと。誰もが「自分の立場から答えられそう」と感じる入口となる問いにする。\n2. 最初の発言者にその問いを向ける\n\n「議論を始めましょう」などの抽象的な言葉は禁止。専門知識なしでも答えられる具体的な問いで始める。firstPersonaIdには必ず上記リストのIDを使用してください。`,
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

  async evaluateIntervention(
    history: DebateTurn[],
    personas: PersonaAttributes[],
    speakCount: Map<string, number> = new Map(),
    currentChapter?: DebateChapter
  ): Promise<Result<FacilitatorIntervention, PipelineError>> {
    try {
      const speakCountInfo = personas
        .map(p => `${p.name}: ${speakCount.get(p.id) ?? 0}回`)
        .join(', ');
      const speakCountNote = `\n\n累計発言数: ${speakCountInfo}\ninviteの場合、発言数が少なく現在の論点との関連性が高い人を優先して選ぶこと。`;
      const chapterContext = currentChapter
        ? `\n\n【この章のミッション】「${currentChapter.title}」\nフォーカス問い: ${currentChapter.focusQuestion}\n司会の役割: この章の間、会話が常にこのフォーカス問いに関連するよう誘導する。`
        : '';

      const response = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.FACILITATOR_INTERVENTION,
        system: buildNeutralitySystemPrompt(),
        tools: [INTERVENTION_TOOL],
        tool_choice: { type: 'tool', name: 'evaluate_intervention' },
        messages: [{
          role: 'user',
          content: `現在の討論を評価し、司会として介入すべきか判断してください。\n\n会話履歴（現在の章のみ）:\n${formatHistory(history.slice(-20))}\n\n参加者:\n${formatPersonas(personas)}${chapterContext}${speakCountNote}\n\n介入基準（優先順）：\n1. 会話がこの章のフォーカス問いから外れている → topic_shift（フォーカス問いに引き戻す具体的な問いかけ）\n2. 同じ論点を繰り返している → topic_shift（フォーカス問いの別の角度から問いかけ）\n3. 発言していない参加者がいる → invite（その人にフォーカス問いに関連した問いを向ける）\n4. フォーカスに沿って活発に議論中 → shouldIntervene=false（介入不要）\n\n章をいつ終えるかはあなたの判断対象外です。議論が深まったと感じても介入せず shouldIntervene=false を返してください。\n\n介入する場合の手順：\n(1) まず誰に問いを向けるかを決め、targetPersonaId に参加者リストのIDを設定する（inviteでは必須）\n(2) 次に content を書く。targetPersonaId の参加者に名前で呼びかけ、「○○さん、〜についてはどうですか？」のように、この章のフォーカス問いに関連した具体的な問いかけにする`,
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
        type?: 'topic_shift' | 'invite';
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

  async generateChapters(
    topicTitle: string,
    personas: PersonaAttributes[]
  ): Promise<Result<{ chapters: DebateChapter[]; generalIssues: string[]; personaIssues: string[] }, PipelineError>> {
    try {
      // Step 1: 切り口洗い出し（一般切り口とペルソナ固有切り口を並列生成）
      const [generalIssuesResponse, personaIssuesResponse] = await Promise.all([
        // 1a: トピックのみ（日常感覚・専門知識不要）
        this.client.messages.create({
          model: AI_MODELS.SONNET,
          max_tokens: MAX_TOKENS.FACILITATOR_CHAPTER_ISSUES,
          system: buildNeutralitySystemPrompt(),
          tools: [SUBMIT_ISSUES_TOOL],
          tool_choice: { type: 'tool', name: 'submit_issues' },
          messages: [{
            role: 'user',
            content: `テーマ「${topicTitle}」について、専門知識を持たない一般の人々が最初に感じる素朴な疑問や関心事を5〜7件列挙してください。\n\n日常の感覚で「自分にも関係ある」「なんとなく気になる」と思える切り口に絞ってください。固有名詞（特定の企業・人名・政策名）や専門用語は使わないこと。各切り口を1〜2文で記述してください。`,
          }],
        }),
        // 1b: ペルソナに基づく（専門的・立場特有の論点）
        this.client.messages.create({
          model: AI_MODELS.SONNET,
          max_tokens: MAX_TOKENS.FACILITATOR_CHAPTER_ISSUES,
          system: buildNeutralitySystemPrompt(),
          tools: [SUBMIT_ISSUES_TOOL],
          tool_choice: { type: 'tool', name: 'submit_issues' },
          messages: [{
            role: 'user',
            content: `テーマ「${topicTitle}」について、以下の参加者それぞれの立場・専門性・利害関係から生まれる具体的な論点や関心事を5〜8件列挙してください。\n\n参加者:\n${formatPersonas(personas)}\n\n各参加者が強い意見・懸念・利害を持つ側面を考慮し、参加者間で意見が対立しやすい切り口を優先してください。各切り口を1〜2文で記述してください。`,
          }],
        }),
      ]);

      const generalIssuesBlock = generalIssuesResponse.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      const personaIssuesBlock = personaIssuesResponse.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (!generalIssuesBlock || !personaIssuesBlock) {
        return { ok: false, error: { code: 'AI_API_ERROR', message: 'No tool_use block in issues response', retryable: true } };
      }
      const { issues: generalIssues } = generalIssuesBlock.input as { issues: string[] };
      const { issues: personaIssues } = personaIssuesBlock.input as { issues: string[] };

      // Step 2: 章構造化（2種の切り口を区別して使用）
      const chaptersResponse = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.FACILITATOR_CHAPTER_STRUCTURE,
        system: buildNeutralitySystemPrompt(),
        tools: [SUBMIT_CHAPTERS_TOOL],
        tool_choice: { type: 'tool', name: 'submit_chapters' },
        messages: [{
          role: 'user',
          content: `以下の2種類の切り口をもとに、討論の章立てを3〜6章に構成してください。\n\n【一般的な切り口（専門知識不要・日常感覚）】\n${generalIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\n\n【参加者固有の切り口（専門的・立場に基づく論点）】\n${personaIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\n\n各章に「章タイトル」と「その章で探求する具体的なフォーカス問い」を設定してください。\n\n【構成の原則・厳守事項】\n- 第1章は必ず「一般的な切り口」から選ぶこと。固有名詞・専門用語・業界用語を第1章のタイトルとフォーカス問いに含めてはならない。\n- 章を追うごとに「参加者固有の切り口」を取り込み、専門性・対立の鋭さを段階的に増す。固有名詞や専門用語は第3章以降から自然に導入してよい。\n- 「誰でも感覚的に答えられる入口 → 具体的な事例・比較 → 深いジレンマ・価値観の対立」の順に進むこと。`,
        }],
      });

      const chaptersBlock = chaptersResponse.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (!chaptersBlock) {
        return { ok: false, error: { code: 'AI_API_ERROR', message: 'No tool_use block in chapters response', retryable: true } };
      }
      const { chapters } = chaptersBlock.input as { chapters: Array<{ title: string; focusQuestion: string }> };

      const debateChapters: DebateChapter[] = chapters.map((c, i) => ({
        index: i,
        title: c.title,
        focusQuestion: c.focusQuestion,
        startTurnIndex: 0,
      }));

      return { ok: true, value: { chapters: debateChapters, generalIssues, personaIssues } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
    }
  }

  async generateChapterSummary(
    recentHistory: DebateTurn[],
    currentChapter: DebateChapter
  ): Promise<Result<string, PipelineError>> {
    try {
      const response = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.FACILITATOR_CHAPTER_TRANSITION,
        system: buildNeutralitySystemPrompt(),
        tools: [GENERATE_CHAPTER_TRANSITION_TOOL],
        tool_choice: { type: 'tool', name: 'generate_chapter_transition' },
        messages: [{
          role: 'user',
          content: `章「${currentChapter.title}」の議論をまとめる発言を生成してください。次の章への言及は不要です。この章で出た主な意見・対立点を簡潔にまとめてください。\n\n直近の会話:\n${formatHistory(recentHistory.slice(-10))}`,
        }],
      });

      const toolBlock = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (!toolBlock) {
        return { ok: false, error: { code: 'AI_API_ERROR', message: 'No tool_use block in summary response', retryable: true } };
      }
      const { content } = toolBlock.input as { content: string };
      return { ok: true, value: content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
    }
  }

  async generateChapterIntroduction(
    nextChapter: DebateChapter,
    personas: PersonaAttributes[]
  ): Promise<Result<{ content: string; firstPersonaId: string }, PipelineError>> {
    try {
      const response = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.FACILITATOR_CHAPTER_TRANSITION,
        system: buildNeutralitySystemPrompt(),
        tools: [CHAPTER_INTRO_TOOL],
        tool_choice: { type: 'tool', name: 'submit_chapter_intro' },
        messages: [{
          role: 'user',
          content: `次の章「${nextChapter.title}」を始める導入発言を生成してください。前の章には触れず、このフォーカス問いについて参加者に問いかける形で始めてください。最初に発言させるペルソナIDも指定してください。\n\nフォーカス: ${nextChapter.focusQuestion}\n\n参加者:\n${formatPersonas(personas)}\n\nfirstPersonaIdには必ず上記リストのIDを使用してください。`,
        }],
      });

      const toolBlock = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (!toolBlock) {
        return { ok: false, error: { code: 'AI_API_ERROR', message: 'No tool_use block in introduction response', retryable: true } };
      }
      const { content, firstPersonaId } = toolBlock.input as { content: string; firstPersonaId: string };
      return { ok: true, value: { content, firstPersonaId } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
    }
  }

  async generateClosing(
    history: DebateTurn[],
    finalBeliefs: Map<string, string>
  ): Promise<Result<string, PipelineError>> {
    try {
      const beliefsSummary = Array.from(finalBeliefs.entries())
        .map(([id, belief]) => `ペルソナ ${id}:\n${belief}`)
        .join('\n\n');

      const response = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.FACILITATOR_CLOSING,
        system: buildNeutralitySystemPrompt(),
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
