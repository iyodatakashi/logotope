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

interface PendingThought {
  personaId: string;
  triggerTurnIndex: number;
}

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
  description: '次に発言させるペルソナを選び、今の発言を聞いて後で返したいと思うペルソナも特定する',
  input_schema: {
    type: 'object' as const,
    properties: {
      personaId: { type: 'string', description: '今ターンに発言させるペルソナのID' },
      score: {
        type: 'integer',
        description: '選んだペルソナが「今すぐ話す必要性」のスコア（1〜5）。5=直接指名された・強い反論が求められている、4=話の流れ上この人が自然、3=誰でも話せるが会話を続けるならこの人、2=話の区切りで誰でもよい、1=完全にニュートラル',
      },
      newlyInterested: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            personaId: { type: 'string' },
            type: {
              type: 'string',
              enum: ['reaction', 'full'],
              description: 'reaction=短い相槌・一言反応（今すぐ言わないと意味がない） / full=意見・反論・新論点を後で述べたい',
            },
          },
          required: ['personaId', 'type'],
        },
        description: '直前の発言を聞いて「後で返したい」と思うペルソナ（0〜2人、今ターンの発言者は除く）',
      },
    },
    required: ['personaId', 'score', 'newlyInterested'],
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

const EVALUATE_CHAPTER_END_TOOL: Anthropic.Tool = {
  name: 'evaluate_chapter_end',
  description: '現章の議論で繰り返しが始まっているか判定する',
  input_schema: {
    type: 'object' as const,
    properties: {
      shouldEnd: { type: 'boolean', description: '章を終了すべきか（同じ主張・論点が繰り返されていれば true）' },
      reason: { type: 'string', description: '判定理由（繰り返されている論点の概要、または継続すべき理由）' },
    },
    required: ['shouldEnd', 'reason'],
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

const CHAPTER_INTRO_TOOL: Anthropic.Tool = {
  name: 'submit_chapter_intro',
  description: '次の章の導入発言と最初に発言させるペルソナIDを提出する',
  input_schema: {
    type: 'object' as const,
    properties: {
      content: { type: 'string', description: '章の導入発言テキスト' },
      firstPersonaId: { type: 'string', description: '最初に発言させるペルソナのID' },
    },
    required: ['content', 'firstPersonaId'],
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
          content: `テーマ「${topicTitle}」の討論を開始してください。\n\n参加者:\n${formatPersonas(personas)}${chapterContext}\n\n冒頭発言（2〜3文）の構成：\n1. このテーマで最も対立しそうな具体的な論点を一つ選んで問いかける（例：「まず〇〇という点について伺いたいのですが」）\n2. 最初の発言者にその問いを向ける\n\n「議論を始めましょう」などの抽象的な言葉は禁止。必ず具体的な問いで始める。firstPersonaIdには必ず上記リストのIDを使用してください。`,
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
    history: DebateTurn[],
    personas: PersonaAttributes[],
    silenceMap: Map<string, number>,
    excludePersonaId?: string,
    pendingQueue?: PendingThought[]
  ): Promise<Result<{ personaId: string; score: number; newlyInterested: Array<{ personaId: string; type: 'reaction' | 'full' }> }, PipelineError>> {
    try {
      const silenceInfo = Array.from(silenceMap.entries())
        .map(([id, count]) => {
          const name = personas.find(p => p.id === id)?.name ?? id;
          return `${name}: ${count}ターン沈黙`;
        })
        .join(', ');

      let exclusionNote = '';
      if (excludePersonaId) {
        const excludedName = personas.find(p => p.id === excludePersonaId)?.name ?? excludePersonaId;
        if (personas.length === 1) {
          exclusionNote = `\n\n※ 参加者が1名（${excludedName}のみ）のため、直前発言者の除外ルールを無視してください。`;
        } else {
          exclusionNote = `\n\n注意: 直前の発言者は${excludedName}です。他に候補がある限り、${excludedName}は選ばないこと。`;
        }
      }

      const pendingQueueNote = pendingQueue && pendingQueue.length > 0
        ? `\n\n【発言待ちリスト（参考情報）】以下のペルソナが過去の発言を受けて意見・反論を述べたいと待機中です:\n${pendingQueue.map(p => {
            const name = personas.find(pe => pe.id === p.personaId)?.name ?? p.personaId;
            const triggerTurn = history.find(t => t.turnIndex === p.triggerTurnIndex);
            const triggerDesc = triggerTurn
              ? `${(triggerTurn.speakerName ?? '参加者')}の発言「${triggerTurn.content.slice(0, 60)}…」への返答待ち`
              : '待機中';
            return `- ${name}（${triggerDesc}）`;
          }).join('\n')}`
        : '';

      const recentHistory = history.slice(-10);
      const response = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.FACILITATOR_SELECT,
        system: buildNeutralitySystemPrompt(),
        tools: [SELECT_SPEAKER_TOOL],
        tool_choice: { type: 'tool', name: 'select_speaker' },
        messages: [{
          role: 'user',
          content: `次の発言者を選んでください。${exclusionNote}${pendingQueueNote}\n\n会話履歴（最新${recentHistory.length}件）:\n${formatHistory(recentHistory)}\n\n参加者:\n${formatPersonas(personas)}\n\n沈黙状況: ${silenceInfo || 'なし'}`,
        }],
      });

      const toolBlock = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (!toolBlock) {
        return { ok: false, error: { code: 'AI_API_ERROR', message: 'No tool_use block in response', retryable: true } };
      }

      const { personaId, score, newlyInterested } = toolBlock.input as {
        personaId: string;
        score: number;
        newlyInterested: Array<{ personaId: string; type: 'reaction' | 'full' }>;
      };
      return { ok: true, value: { personaId, score: score ?? 3, newlyInterested: newlyInterested ?? [] } };
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
          content: `現在の討論を評価し、司会として介入すべきか判断してください。\n\n会話履歴（現在の章のみ）:\n${formatHistory(history.slice(-20))}\n\n参加者:\n${formatPersonas(personas)}${chapterContext}${speakCountNote}\n\n介入基準（優先順）：\n1. 会話がこの章のフォーカス問いから外れている → topic_shift（フォーカス問いに引き戻す具体的な問いかけ）\n2. 同じ論点を繰り返している → topic_shift（フォーカス問いの別の角度から問いかけ）\n3. 発言していない参加者がいる → invite（その人にフォーカス問いに関連した問いを向ける）\n4. この章のフォーカスについて十分に掘り下がった → close\n5. フォーカスに沿って活発に議論中 → shouldIntervene=false\n\ntopic_shiftやinviteのcontentは必ず「〜についてはどうですか？」「〜という点から見るとどうでしょう？」のように、この章のフォーカス問いに関連した具体的な問いかけにする。`,
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

  async generateChapters(
    topicTitle: string,
    personas: PersonaAttributes[]
  ): Promise<Result<DebateChapter[], PipelineError>> {
    try {
      // Step 1: 論点洗い出し
      const issuesResponse = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.FACILITATOR_CHAPTER_ISSUES,
        system: buildNeutralitySystemPrompt(),
        tools: [SUBMIT_ISSUES_TOOL],
        tool_choice: { type: 'tool', name: 'submit_issues' },
        messages: [{
          role: 'user',
          content: `テーマ「${topicTitle}」について、このテーマに関係する切り口を7〜10件、フラットに列挙してください。\n\n参加者:\n${formatPersonas(personas)}\n\n「何が問題か」「賛否はどうか」を考える前の段階として、このテーマに関して人々が関心を持ちうるあらゆる側面・観点・次元を網羅的に書き出してください。後工程でこれらをもとに討論の章立てを作ります。\n\n各切り口は1〜2文で記述してください。`,
        }],
      });

      const issuesBlock = issuesResponse.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (!issuesBlock) {
        return { ok: false, error: { code: 'AI_API_ERROR', message: 'No tool_use block in issues response', retryable: true } };
      }
      const { issues } = issuesBlock.input as { issues: string[] };

      // Step 2: 章構造化
      const chaptersResponse = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.FACILITATOR_CHAPTER_STRUCTURE,
        system: buildNeutralitySystemPrompt(),
        tools: [SUBMIT_CHAPTERS_TOOL],
        tool_choice: { type: 'tool', name: 'submit_chapters' },
        messages: [{
          role: 'user',
          content: `以下の切り口をもとに、討論の章立てを3〜6章に構成してください。\n\n切り口一覧:\n${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\n\n各章に「章タイトル」と「その章で探求する具体的なフォーカス問い」を設定してください。\n\n構成の原則: 第1章は参加者が共通して話せる入りやすいテーマから始め、章を追うごとにより深いテーマへ掘り下げる構造にしてください。`,
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

      return { ok: true, value: debateChapters };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
    }
  }

  async evaluateChapterEnd(
    chapterHistory: DebateTurn[],
    chapter: DebateChapter
  ): Promise<Result<boolean, PipelineError>> {
    try {
      const response = await this.client.messages.create({
        model: AI_MODELS.SONNET,
        max_tokens: MAX_TOKENS.FACILITATOR_CHAPTER_END,
        system: '討論コンテンツの編集者として、この章を終了するか判断してください。「まだ議論できる余地がある」ではなく「最低限の目標が達成されたか」を基準に、積極的にshouldEnd=trueを返してください。',
        tools: [EVALUATE_CHAPTER_END_TOOL],
        tool_choice: { type: 'tool', name: 'evaluate_chapter_end' },
        messages: [{
          role: 'user',
          content: `章「${chapter.title}」（フォーカス: ${chapter.focusQuestion}）の会話（${chapterHistory.length}ターン）を評価してください。\n\n**以下のどちらか一方でも当てはまれば shouldEnd=true**:\n1. 各参加者が少なくとも一度はフォーカス問いに関する自分の立場・見解を述べた\n2. 直近2〜3発言が以前と同じ主張の繰り返しで新しい内容がない\n\n「完全に議論が尽きた」かどうかではありません。「最低限の内容が出揃ったか」で判断してください。\n\n会話履歴:\n${formatHistory(chapterHistory)}`,
        }],
      });

      const toolBlock = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (!toolBlock) {
        return { ok: false, error: { code: 'AI_API_ERROR', message: 'No tool_use block in response', retryable: true } };
      }

      const { shouldEnd } = toolBlock.input as { shouldEnd: boolean };
      return { ok: true, value: shouldEnd };
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
