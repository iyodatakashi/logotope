import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGenerateText, mockGetPersonaModel } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockGetPersonaModel: vi.fn(),
}));

vi.mock('ai', () => ({
  generateText: mockGenerateText,
  jsonSchema: (schema: unknown) => schema,
}));

vi.mock('../llm/models.js', () => ({
  getPersonaModel: mockGetPersonaModel,
}));

import { PersonaAgentService, buildSpeechStyleGuide } from './persona-agent.js';
import type { TurnGenerationContext } from './persona-agent.js';
import type { PersonaAttributes, DebateChapter } from '../types/index.js';
import type { SearchService } from '../search/search-service.js';

const mockDisabledSearch = {
  isAvailable: vi.fn(() => false),
  executeSearch: vi.fn(),
} as unknown as SearchService;

const mockModel = { _provider: 'anthropic', _modelId: 'claude-sonnet-4-6' };

const testPersona: PersonaAttributes = {
  id: 'p1',
  stakeholderRole: '医師',
  name: '田中太郎',
  age: 45,
  occupation: '外科医',
  background: '30年の臨床経験を持つベテラン外科医',
  interests: '医療安全・患者ケアの質向上',
};

const testInterviewRecord =
  '田中医師は医療安全を最優先に考えており、この政策が患者アウトカムの改善につながると信じている。費用対効果の観点からも賛成。';

const testCurrentBelief =
  '# 現在の信念\n\n## 立場と根拠\n本政策は医療安全強化に必要。\n\n## 核心的主張\n患者の命を守ることが最優先事項。';

const testChapter: DebateChapter = { index: 0, title: '導入', focusQuestion: 'この問題の核心は何か？', startTurnIndex: 0 };

const testHistory = [
  { id: 't1', sessionId: 's1', turnIndex: 0, speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '', content: '本日はAI医療診断の導入について討論します。', createdAt: '2025-01-01' },
  { id: 't2', sessionId: 's1', turnIndex: 1, speakerType: 'persona', speakerName: '鈴木花子', speakerRole: '患者', content: '患者として、費用負担が大きくなることが非常に心配です。', createdAt: '2025-01-01' },
  { id: 't3', sessionId: 's1', turnIndex: 2, speakerType: 'persona', speakerName: '山田次郎', speakerRole: '研究者', content: 'データを見ると、AI診断は誤診率を30%削減するという研究結果が出ています。', createdAt: '2025-01-01' },
];

const makeTurnResult = (args: Record<string, unknown> = { content: '発言。' }) => ({
  toolCalls: [{ toolName: 'submit_turn', args }],
  steps: [{ toolCalls: [{ toolName: 'submit_turn', args }] }],
  text: '',
  toolResults: [],
  finishReason: 'tool-calls',
  usage: { promptTokens: 0, completionTokens: 0 },
});

const makeTurnResultWithSearch = (args: Record<string, unknown> = { content: '発言。' }, query = '少子化 統計') => ({
  toolCalls: [{ toolName: 'submit_turn', args }],
  steps: [
    { toolCalls: [{ toolName: 'web_search', args: { query } }] },
    { toolCalls: [{ toolName: 'submit_turn', args }] },
  ],
  text: '',
  toolResults: [],
  finishReason: 'tool-calls',
  usage: { promptTokens: 0, completionTokens: 0 },
});

const makeEngagementResult = (args: Record<string, unknown>) => ({
  toolCalls: [{ toolName: 'assess_engagement', args }],
  text: '',
  toolResults: [],
  finishReason: 'tool-calls',
  usage: { promptTokens: 0, completionTokens: 0 },
});

const makePostDebateResult = (content: string) => ({
  toolCalls: [{ toolName: 'submit_post_debate_comment', args: { content } }],
  text: '',
  toolResults: [],
  finishReason: 'tool-calls',
  usage: { promptTokens: 0, completionTokens: 0 },
});

const ctx = (overrides: Partial<TurnGenerationContext> = {}): TurnGenerationContext => ({
  chapterHistory: testHistory,
  chapter: testChapter,
  nominatedByFacilitator: false,
  ...overrides,
});

let service: PersonaAgentService;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPersonaModel.mockReturnValue(mockModel);
  mockGenerateText.mockResolvedValue(makeTurnResult());
  service = new PersonaAgentService(mockDisabledSearch);
});

// ---- buildSpeechStyleGuide (unchanged pure function tests) ----

describe('buildSpeechStyleGuide', () => {
  const base = {
    id: 'p1',
    background: '特になし',
    interests: '特になし',
  };

  it('若手ペルソナ: 口語体・疑問形の語り口指針を含む', () => {
    const persona: PersonaAttributes = {
      ...base, stakeholderRole: '一般市民', name: '若者', age: 22, occupation: '会社員（入社2年目）',
    };
    const guide = buildSpeechStyleGuide(persona);
    expect(guide).toBeTruthy();
    expect(guide.split('\n').length).toBeGreaterThanOrEqual(3);
    expect(guide.split('\n').length).toBeLessThanOrEqual(5);
    expect(guide).toMatch(/口語|疑問形|若手|経験が少/);
  });

  it('ベテランペルソナ: 経験・断言の語り口指針を含む', () => {
    const persona: PersonaAttributes = {
      ...base, stakeholderRole: '現場職', name: '田中', age: 58, occupation: 'ベテランエンジニア',
    };
    const guide = buildSpeechStyleGuide(persona);
    expect(guide).toBeTruthy();
    expect(guide).toMatch(/経験|断言|専門|ベテラン/);
  });

  it('経営者ペルソナ: 断言的・謙遜なしの語り口指針を含む', () => {
    const persona: PersonaAttributes = {
      ...base, stakeholderRole: '経営者', name: '鈴木', age: 50, occupation: '代表取締役',
    };
    const guide = buildSpeechStyleGuide(persona);
    expect(guide).toBeTruthy();
    expect(guide).toMatch(/断言|謙遜|自信|権威/);
  });

  it('gender あり: 例外なく動作し非空文字列を返す', () => {
    const persona: PersonaAttributes & { gender?: string } = {
      ...base, stakeholderRole: '患者', name: '山田', age: 40, occupation: '主婦', gender: '女性',
    };
    expect(typeof buildSpeechStyleGuide(persona)).toBe('string');
    expect(buildSpeechStyleGuide(persona).length).toBeGreaterThan(0);
  });

  it('gender なし: 例外なく動作し非空文字列を返す', () => {
    const persona: PersonaAttributes = {
      ...base, stakeholderRole: '患者', name: '佐藤', age: 40, occupation: '会社員',
    };
    expect(typeof buildSpeechStyleGuide(persona)).toBe('string');
    expect(buildSpeechStyleGuide(persona).length).toBeGreaterThan(0);
  });

  it('属性が変わると語り口指針も変わる', () => {
    const young: PersonaAttributes = { ...base, stakeholderRole: '一般市民', name: '若者', age: 22, occupation: '大学生' };
    const veteran: PersonaAttributes = { ...base, stakeholderRole: '専門家', name: '老人', age: 65, occupation: 'ベテラン教授' };
    expect(buildSpeechStyleGuide(young)).not.toBe(buildSpeechStyleGuide(veteran));
  });
});

// ---- システムプロンプトとツール定義への統合 ----

describe('task 1.2: スタイルガイドのシステムプロンプトとツール定義への統合', () => {
  const youngPersona: PersonaAttributes = {
    id: 'y1', stakeholderRole: '一般市民', name: '若者', age: 22, occupation: '大学生',
    background: '特になし', interests: '特になし',
  };
  const executivePersona: PersonaAttributes = {
    id: 'e1', stakeholderRole: '経営者', name: '社長', age: 55, occupation: '代表取締役',
    background: '特になし', interests: '特になし',
  };

  it('発言スタイルセクション先頭（発言の長さルールより前）に語り口指針が含まれる', async () => {
    await service.generateTurn(youngPersona, 'belief', 'interview', ctx({ chapterHistory: [] }));

    const system: string = mockGenerateText.mock.calls[0][0].system;
    const sectionStart = system.indexOf('## 発言スタイルの厳守事項');
    const styleIdx = system.indexOf('口語', sectionStart);
    const constraintIdx = system.indexOf('討論のプロではない', sectionStart);

    expect(styleIdx).toBeGreaterThan(sectionStart);
    expect(styleIdx).toBeLessThan(constraintIdx);
  });

  it('若手ペルソナのシステムプロンプトに口語・疑問形スタイルが含まれる', async () => {
    await service.generateTurn(youngPersona, 'belief', 'interview', ctx({ chapterHistory: [] }));
    expect(mockGenerateText.mock.calls[0][0].system).toMatch(/口語|疑問形/);
  });

  it('経営者ペルソナのシステムプロンプトに断言的スタイルが含まれる', async () => {
    await service.generateTurn(executivePersona, 'belief', 'interview', ctx({ chapterHistory: [] }));
    expect(mockGenerateText.mock.calls[0][0].system).toMatch(/断言|謙遜|権威/);
  });

  it('若手と経営者ペルソナでシステムプロンプトの語り口指針が異なる', async () => {
    await service.generateTurn(youngPersona, 'belief', 'interview', ctx({ chapterHistory: [] }));
    const youngSystem: string = mockGenerateText.mock.calls[0][0].system;
    vi.clearAllMocks();
    mockGetPersonaModel.mockReturnValue(mockModel);
    mockGenerateText.mockResolvedValue(makeTurnResult());

    await service.generateTurn(executivePersona, 'belief', 'interview', ctx({ chapterHistory: [] }));
    const execSystem: string = mockGenerateText.mock.calls[0][0].system;

    expect(youngSystem).not.toBe(execSystem);
  });

  it('TURN_TOOL の content フィールド説明に語り口スタイルが含まれる', async () => {
    await service.generateTurn(youngPersona, 'belief', 'interview', ctx({ chapterHistory: [] }));

    const tools = mockGenerateText.mock.calls[0][0].tools as Record<string, { parameters: { properties: { content: { description: string } } } }>;
    const submitTurn = tools['submit_turn'];
    expect(submitTurn.parameters.properties.content.description).toMatch(/口語|疑問形|語り口/);
  });
});

// ---- PersonaAgentService DI ----

describe('PersonaAgentService DI', () => {
  it('SearchService を注入してインスタンス化できる', () => {
    expect(() => new PersonaAgentService(mockDisabledSearch)).not.toThrow();
  });
});

// ---- generateTurn ----

describe('PersonaAgentService', () => {
  describe('generateTurn — beliefChange 3ケース', () => {
    it('信念変化なし: beliefChange が null で content が返る', async () => {
      mockGenerateText.mockResolvedValue(makeTurnResult({ content: '医療安全の観点から、AI導入は適切なプロセスを経れば有益だと考えます。' }));

      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBeTruthy();
      expect(result.value.beliefChange).toBeNull();
    });

    it('opinion_change: 完全な意見変化として BeliefChangeEvent が返る', async () => {
      mockGenerateText.mockResolvedValue(makeTurnResult({
        content: '鈴木さんの話を聞いて、考えが変わりました。費用問題は深刻です。',
        beliefChangeType: 'opinion_change',
        beliefChangeSummary: '患者の経済的負担が医療安全より優先されるべきと認識を改めた',
        beliefChangeUpdatedBelief: '# 更新後の信念\n費用負担の問題を解決してから導入すべき。',
      }));

      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.beliefChange).not.toBeNull();
      expect(result.value.beliefChange?.type).toBe('opinion_change');
      expect(result.value.beliefChange?.summary).toBeTruthy();
      expect(result.value.beliefChange?.updatedBelief).toBeTruthy();
    });

    it('partial_acceptance: 部分的承認として BeliefChangeEvent が返る', async () => {
      mockGenerateText.mockResolvedValue(makeTurnResult({
        content: '山田さんのデータは興味深い。費用問題は残るが、安全性向上は認めます。',
        beliefChangeType: 'partial_acceptance',
        beliefChangeSummary: 'AI診断の安全性向上効果は認めるが、費用問題の解決が前提条件と認識した',
        beliefChangeUpdatedBelief: '# 更新後の信念\n安全性向上は評価するが、費用問題の解決を条件に支持。',
      }));

      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.beliefChange?.type).toBe('partial_acceptance');
    });
  });

  describe('generateTurn — addressedToPersonaId', () => {
    it('addressedToPersonaId あり: 特定ペルソナへの返答が返る', async () => {
      mockGenerateText.mockResolvedValue(makeTurnResult({
        content: '鈴木さん、その費用の具体的な数字はどこから来ているのでしょうか？',
        addressedToPersonaId: 'p2',
      }));

      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.addressedToPersonaId).toBe('p2');
      expect(result.value.beliefChange).toBeNull();
    });

    it('addressedToPersonaId なし: undefined が返る', async () => {
      mockGenerateText.mockResolvedValue(makeTurnResult({ content: 'データに基づいて判断することが重要です。' }));

      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.addressedToPersonaId).toBeUndefined();
    });
  });

  describe('generateTurn — システムプロンプト検証', () => {
    it('システムプロンプトにペルソナ属性が含まれる', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());

      const call = mockGenerateText.mock.calls[0][0];
      expect(call.system).toMatch(/田中太郎/);
      expect(call.system).toMatch(/外科医/);
      expect(call.system).toMatch(/医師/);
    });

    it('システムプロンプトに取材レコードが含まれる', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());

      const call = mockGenerateText.mock.calls[0][0];
      expect(call.system).toContain(testInterviewRecord);
    });

    it('システムプロンプトに現在の信念ドキュメントが含まれる', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      expect(mockGenerateText.mock.calls[0][0].system).toContain(testCurrentBelief);
    });

    it('他ペルソナの取材レコード・信念はシステムプロンプトに含まれない', async () => {
      const otherPersonaBelief = '他のペルソナの秘密の信念ドキュメント_UNIQUE_STRING';
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      expect(mockGenerateText.mock.calls[0][0].system).not.toContain(otherPersonaBelief);
    });
  });

  describe('generateTurn — LLM ルーティング（task 5.1）', () => {
    it('persona.llmType に応じた getPersonaModel が呼び出される', async () => {
      const personaWithLlmType = { ...testPersona, llmType: 'gemini' as const };
      await service.generateTurn(personaWithLlmType, testCurrentBelief, testInterviewRecord, ctx());
      expect(mockGetPersonaModel).toHaveBeenCalledWith('gemini');
    });

    it('llmType が未設定の場合は claude にフォールバックして getPersonaModel を呼び出す', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      expect(mockGetPersonaModel).toHaveBeenCalledWith('claude');
    });

    it('プロバイダー API エラー時に claude でフォールバックして generateText を再実行する', async () => {
      const claudeModel = { _provider: 'anthropic', _modelId: 'claude-sonnet-4-6' };
      mockGetPersonaModel
        .mockReturnValueOnce({ _provider: 'google', _modelId: 'gemini-2.5-flash' })
        .mockReturnValueOnce(claudeModel);
      mockGenerateText
        .mockRejectedValueOnce(new Error('Provider API error'))
        .mockResolvedValueOnce(makeTurnResult({ content: 'フォールバック発言。' }));

      const personaWithLlmType = { ...testPersona, llmType: 'gemini' as const };
      const result = await service.generateTurn(personaWithLlmType, testCurrentBelief, testInterviewRecord, ctx());

      expect(result.ok).toBe(true);
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
      expect(mockGetPersonaModel).toHaveBeenNthCalledWith(1, 'gemini');
      expect(mockGetPersonaModel).toHaveBeenNthCalledWith(2, 'claude');
    });
  });

  describe('generateTurn — エラーハンドリング', () => {
    it('generateText 失敗（フォールバック後も失敗）時に error result を返す', async () => {
      mockGenerateText.mockRejectedValue(new Error('API rate limit exceeded'));
      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('AI_API_ERROR');
    });

    it('エラーは retryable: true を返す', async () => {
      mockGenerateText.mockRejectedValue(new Error('network error'));
      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({ code: 'AI_API_ERROR', retryable: true });
    });
  });

  describe('generateTurn - task 3.1: TurnGenerationContext 統合', () => {
    it('context.chapter の章タイトルとフォーカス問いが user メッセージに含まれる', async () => {
      const chapter: DebateChapter = { index: 1, title: '核心的対立', focusQuestion: '最も意見が分かれる点はどこか？', startTurnIndex: 5 };
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx({ chapter }));

      const msg: string = mockGenerateText.mock.calls[0][0].messages[0].content;
      expect(msg).toMatch(/核心的対立/);
      expect(msg).toMatch(/最も意見が分かれる点はどこか？/);
    });

    it('context.chapterHistory の発言内容が user メッセージに含まれる', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      const msg: string = mockGenerateText.mock.calls[0][0].messages[0].content;
      expect(msg).toContain('費用負担が大きくなることが非常に心配です');
    });

    it('mode: opinion のとき speechMode が opinion で toolChoice が required になる', async () => {
      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx({ mode: 'opinion' }));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.speechMode).toBe('opinion');
      const call = mockGenerateText.mock.calls[0][0];
      expect(call.toolChoice).toBe('required');
    });

    it('pendingTrigger が【持ち越しの言いたいこと】として user メッセージに含まれる', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx({
        pendingTrigger: { speakerName: '鈴木花子', content: '費用負担が心配です' },
      }));

      const msg: string = mockGenerateText.mock.calls[0][0].messages[0].content;
      expect(msg).toContain('【持ち越しの言いたいこと】');
      expect(msg).toContain('鈴木花子');
      expect(msg).toContain('費用負担が心配です');
    });

    it('nominatedByFacilitator: true のとき【指名】が user メッセージに含まれる', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx({ nominatedByFacilitator: true }));
      const msg: string = mockGenerateText.mock.calls[0][0].messages[0].content;
      expect(msg).toContain('【指名】');
    });

    it('nominatedByFacilitator: false のとき【指名】が含まれない', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      const msg: string = mockGenerateText.mock.calls[0][0].messages[0].content;
      expect(msg).not.toContain('【指名】');
    });

    it('context.chapter を変えても system プロンプトは変わらない', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      const systemBase: string = mockGenerateText.mock.calls[0][0].system;
      vi.clearAllMocks();
      mockGetPersonaModel.mockReturnValue(mockModel);
      mockGenerateText.mockResolvedValue(makeTurnResult());

      const chapter: DebateChapter = { index: 2, title: '影響', focusQuestion: 'どんな影響があるか？', startTurnIndex: 10 };
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx({ chapter }));
      const systemWith: string = mockGenerateText.mock.calls[0][0].system;

      expect(systemWith).toBe(systemBase);
    });
  });

  // ---- assessEngagement ----

  describe('assessEngagement — Task 2.1 スキーマ拡張', () => {
    it('mode フィールドが返り値に含まれる', async () => {
      mockGenerateText.mockResolvedValue(makeEngagementResult({ score: 4, mode: 'opinion', intentSummary: '医療費問題に反論したい' }));
      const result = await service.assessEngagement(testPersona, testCurrentBelief, testInterviewRecord, testHistory);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.mode).toBe('opinion');
    });

    it('intentSummary フィールドが返り値に含まれる', async () => {
      mockGenerateText.mockResolvedValue(makeEngagementResult({ score: 3, mode: 'opinion', intentSummary: 'そうですね' }));
      const result = await service.assessEngagement(testPersona, testCurrentBelief, testInterviewRecord, testHistory);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.intentSummary).toBe('そうですね');
    });

    it('score === 1 のとき mode が強制的に none になる', async () => {
      mockGenerateText.mockResolvedValue(makeEngagementResult({ score: 1, mode: 'opinion', intentSummary: '発言したい' }));
      const result = await service.assessEngagement(testPersona, testCurrentBelief, testInterviewRecord, testHistory);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.mode).toBe('none');
    });

    it('mode === none のとき intentSummary が undefined になる', async () => {
      mockGenerateText.mockResolvedValue(makeEngagementResult({ score: 2, mode: 'none', intentSummary: 'なにか言いたい' }));
      const result = await service.assessEngagement(testPersona, testCurrentBelief, testInterviewRecord, testHistory);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.intentSummary).toBeUndefined();
    });

    it('ASSESS_ENGAGEMENT_TOOL スキーマに mode フィールドが含まれる', async () => {
      mockGenerateText.mockResolvedValue(makeEngagementResult({ score: 3, mode: 'opinion' }));
      await service.assessEngagement(testPersona, testCurrentBelief, testInterviewRecord, testHistory);
      const tools = mockGenerateText.mock.calls[0][0].tools as Record<string, { parameters: { properties: Record<string, unknown> } }>;
      expect(tools['assess_engagement'].parameters.properties).toHaveProperty('mode');
    });

    it('ASSESS_ENGAGEMENT_TOOL スキーマに intentSummary フィールドが含まれる', async () => {
      mockGenerateText.mockResolvedValue(makeEngagementResult({ score: 3, mode: 'opinion', intentSummary: '意見あり' }));
      await service.assessEngagement(testPersona, testCurrentBelief, testInterviewRecord, testHistory);
      const tools = mockGenerateText.mock.calls[0][0].tools as Record<string, { parameters: { properties: Record<string, unknown> } }>;
      expect(tools['assess_engagement'].parameters.properties).toHaveProperty('intentSummary');
    });

    it('assessEngagement が persona.llmType に応じた getPersonaModel を呼び出す（task 5.2）', async () => {
      mockGenerateText.mockResolvedValue(makeEngagementResult({ score: 3, mode: 'opinion' }));
      const personaWithLlmType = { ...testPersona, llmType: 'gemini' as const };
      await service.assessEngagement(personaWithLlmType, testCurrentBelief, testInterviewRecord, testHistory);
      expect(mockGetPersonaModel).toHaveBeenCalledWith('gemini');
    });
  });

  describe('generateTurn — Task 2.2 intentSummary プロンプト埋め込み', () => {
    it('intentSummary が渡された場合、ユーザープロンプトに【今回伝えたいこと】が含まれる', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx({ intentSummary: '医療費問題をしっかり主張したい' }));
      const msg: string = mockGenerateText.mock.calls[0][0].messages[0].content;
      expect(msg).toContain('【今回伝えたいこと】医療費問題をしっかり主張したい');
    });

    it('intentSummary が undefined の場合、プロンプトに【今回伝えたいこと】が追記されない', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      const msg: string = mockGenerateText.mock.calls[0][0].messages[0].content;
      expect(msg).not.toContain('【今回伝えたいこと】');
    });
  });

  // ---- generatePostDebateComment ----

  describe('generatePostDebateComment', () => {
    it('personaId と content を含む PostDebateCommentResult を返す', async () => {
      mockGenerateText.mockResolvedValue(makePostDebateResult('鈴木さんの費用負担への懸念は私が気づいていなかった視点でした。'));

      const result = await service.generatePostDebateComment(testPersona, testCurrentBelief, testHistory);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.personaId).toBe('p1');
      expect(result.value.content).toBeTruthy();
    });

    it('コメント内容が非空文字列である', async () => {
      mockGenerateText.mockResolvedValue(makePostDebateResult('今回の議論を通じて多くのことを学びました。'));
      const result = await service.generatePostDebateComment(testPersona, testCurrentBelief, testHistory);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(typeof result.value.content).toBe('string');
      expect(result.value.content.length).toBeGreaterThan(0);
    });

    it('システムプロンプトにペルソナ属性が含まれる', async () => {
      mockGenerateText.mockResolvedValue(makePostDebateResult('コメント内容。'));
      await service.generatePostDebateComment(testPersona, testCurrentBelief, testHistory);
      expect(mockGenerateText.mock.calls[0][0].system).toMatch(/田中太郎/);
    });

    it('generatePostDebateComment が persona.llmType に応じた getPersonaModel を呼び出す（task 5.2）', async () => {
      mockGenerateText.mockResolvedValue(makePostDebateResult('コメント。'));
      const personaWithLlmType = { ...testPersona, llmType: 'gpt' as const };
      await service.generatePostDebateComment(personaWithLlmType, testCurrentBelief, testHistory);
      expect(mockGetPersonaModel).toHaveBeenCalledWith('gpt');
    });

    it('generateText 失敗時に error result を返す', async () => {
      mockGenerateText.mockRejectedValue(new Error('API error'));
      const result = await service.generatePostDebateComment(testPersona, testCurrentBelief, testHistory);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('AI_API_ERROR');
    });
  });

  describe('generateTurn — システムプロンプト検索ガイダンス（Task 3）', () => {
    it('「個人経験のみ」制限がシステムプロンプトに含まれない', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      const system: string = mockGenerateText.mock.calls[0][0].system;
      expect(system).not.toContain('自分が直接経験したこと');
      expect(system).not.toContain('職場で見聞きしたことに限る');
    });

    it('情報収集ガイダンスセクションがシステムプロンプトに含まれる', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      const system: string = mockGenerateText.mock.calls[0][0].system;
      expect(system).toContain('情報収集について');
    });

    it('factInstruction に検索ツール参照が含まれ旧制限が含まれない', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx({ mode: 'fact' }));
      const msg: string = mockGenerateText.mock.calls[0][0].messages[0].content;
      expect(msg).not.toContain('事前取材レコードの範囲にとどめ');
      expect(msg).toContain('検索ツールで確認した情報');
    });
  });

  describe('generateTurn — 検索統合（Task 4.1/4.2）', () => {
    it('SearchService が利用不可の場合 web_search ツールが含まれない', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      const tools = mockGenerateText.mock.calls[0][0].tools as Record<string, unknown>;
      expect(tools).not.toHaveProperty('web_search');
    });

    it('SearchService が利用可能な場合 web_search ツールが含まれる', async () => {
      const searchSvc = {
        isAvailable: vi.fn(() => true),
        executeSearch: vi.fn().mockResolvedValue({ ok: true, content: '結果' }),
      } as unknown as SearchService;
      const serviceWithSearch = new PersonaAgentService(searchSvc);
      await serviceWithSearch.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      const tools = mockGenerateText.mock.calls[0][0].tools as Record<string, unknown>;
      expect(tools).toHaveProperty('web_search');
    });

    it('toolChoice が required になる', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      expect(mockGenerateText.mock.calls[0][0].toolChoice).toBe('required');
    });

    it('maxSteps が 4 になる', async () => {
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      expect(mockGenerateText.mock.calls[0][0].maxSteps).toBe(4);
    });

    it('steps に web_search がある場合 searchUsed: true と searchQueries が返る', async () => {
      mockGenerateText.mockResolvedValue(makeTurnResultWithSearch({ content: '発言。' }, '少子化 統計'));
      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.searchUsed).toBe(true);
      expect(result.value.searchQueries).toContain('少子化 統計');
    });

    it('steps に web_search がない場合 searchUsed が undefined', async () => {
      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, ctx());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.searchUsed).toBeUndefined();
    });
  });
});
