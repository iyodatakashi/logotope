import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}));

import Anthropic from '@anthropic-ai/sdk';
import { PersonaAgentService, buildSpeechStyleGuide } from './persona-agent.js';
import type { PersonaAttributes, ConversationTurn, DebateChapter } from '../types/index.js';

const mockCreate = vi.fn();

const testPersona: PersonaAttributes = {
  id: 'p1',
  stakeholderRole: '医師',
  name: '田中太郎',
  age: 45,
  occupation: '外科医',
  background: '30年の臨床経験を持つベテラン外科医',
  interests: '医療安全・患者ケアの質向上',
  stanceDirection: 'pro',
};

const testInterviewRecord =
  '田中医師は医療安全を最優先に考えており、この政策が患者アウトカムの改善につながると信じている。費用対効果の観点からも賛成。';

const testCurrentBelief =
  '# 現在の信念\n\n## 立場と根拠\n本政策は医療安全強化に必要。\n\n## 核心的主張\n患者の命を守ることが最優先事項。';

const testHistory: ConversationTurn[] = [
  {
    turnId: 't1',
    turnIndex: 0,
    speakerType: 'facilitator',
    speakerName: 'ファシリテーター',
    speakerRole: '',
    content: '本日はAI医療診断の導入について討論します。',
  },
  {
    turnId: 't2',
    turnIndex: 1,
    speakerType: 'persona',
    speakerName: '鈴木花子',
    speakerRole: '患者',
    content: '患者として、費用負担が大きくなることが非常に心配です。現在の医療費でも苦しいのに。',
  },
  {
    turnId: 't3',
    turnIndex: 2,
    speakerType: 'persona',
    speakerName: '山田次郎',
    speakerRole: '研究者',
    content: 'データを見ると、AI診断は誤診率を30%削減するという研究結果が出ています。',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Anthropic).mockImplementation(() => ({
    messages: { create: mockCreate },
  }) as unknown as Anthropic);
});

describe('buildSpeechStyleGuide', () => {
  const base = {
    id: 'p1',
    background: '特になし',
    interests: '特になし',
    stanceDirection: 'neutral' as const,
  };

  it('若手ペルソナ: 口語体・疑問形の語り口指針を含む', () => {
    const persona: PersonaAttributes = {
      ...base,
      stakeholderRole: '一般市民',
      name: '若者',
      age: 22,
      occupation: '会社員（入社2年目）',
    };
    const guide = buildSpeechStyleGuide(persona);
    expect(guide).toBeTruthy();
    expect(guide.split('\n').length).toBeGreaterThanOrEqual(3);
    expect(guide.split('\n').length).toBeLessThanOrEqual(5);
    expect(guide).toMatch(/口語|疑問形|若手|経験が少/);
  });

  it('ベテランペルソナ: 経験・断言の語り口指針を含む', () => {
    const persona: PersonaAttributes = {
      ...base,
      stakeholderRole: '現場職',
      name: '田中',
      age: 58,
      occupation: 'ベテランエンジニア',
    };
    const guide = buildSpeechStyleGuide(persona);
    expect(guide).toBeTruthy();
    expect(guide).toMatch(/経験|断言|専門|ベテラン/);
  });

  it('経営者ペルソナ: 断言的・謙遜なしの語り口指針を含む', () => {
    const persona: PersonaAttributes = {
      ...base,
      stakeholderRole: '経営者',
      name: '鈴木',
      age: 50,
      occupation: '代表取締役',
    };
    const guide = buildSpeechStyleGuide(persona);
    expect(guide).toBeTruthy();
    expect(guide).toMatch(/断言|謙遜|自信|権威/);
  });

  it('gender あり: 例外なく動作し非空文字列を返す', () => {
    const persona: PersonaAttributes & { gender?: string } = {
      ...base,
      stakeholderRole: '患者',
      name: '山田',
      age: 40,
      occupation: '主婦',
      gender: '女性',
    };
    const guide = buildSpeechStyleGuide(persona);
    expect(typeof guide).toBe('string');
    expect(guide.length).toBeGreaterThan(0);
  });

  it('gender なし: 例外なく動作し非空文字列を返す', () => {
    const persona: PersonaAttributes = {
      ...base,
      stakeholderRole: '患者',
      name: '佐藤',
      age: 40,
      occupation: '会社員',
    };
    const guide = buildSpeechStyleGuide(persona);
    expect(typeof guide).toBe('string');
    expect(guide.length).toBeGreaterThan(0);
  });

  it('属性が変わると語り口指針も変わる', () => {
    const young: PersonaAttributes = {
      ...base,
      stakeholderRole: '一般市民',
      name: '若者',
      age: 22,
      occupation: '大学生',
    };
    const veteran: PersonaAttributes = {
      ...base,
      stakeholderRole: '専門家',
      name: '老人',
      age: 65,
      occupation: 'ベテラン教授',
    };
    expect(buildSpeechStyleGuide(young)).not.toBe(buildSpeechStyleGuide(veteran));
  });
});

describe('task 1.2: スタイルガイドのシステムプロンプトとツール定義への統合', () => {
  let service: PersonaAgentService;

  const youngPersona: PersonaAttributes = {
    id: 'y1',
    stakeholderRole: '一般市民',
    name: '若者',
    age: 22,
    occupation: '大学生',
    background: '特になし',
    interests: '特になし',
    stanceDirection: 'neutral',
  };

  const executivePersona: PersonaAttributes = {
    id: 'e1',
    stakeholderRole: '経営者',
    name: '社長',
    age: 55,
    occupation: '代表取締役',
    background: '特になし',
    interests: '特になし',
    stanceDirection: 'pro',
  };

  beforeEach(() => {
    service = new PersonaAgentService();
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'submit_turn', input: { content: '発言。' } }],
    });
  });

  it('発言スタイルセクション先頭（発言の長さルールより前）に語り口指針が含まれる', async () => {
    await service.generateTurn(youngPersona, 'belief', 'interview', []);

    const system: string = mockCreate.mock.calls[0][0].system;
    const sectionStart = system.indexOf('## 発言スタイルの厳守事項');
    const styleIdx = system.indexOf('口語', sectionStart);
    const constraintIdx = system.indexOf('reaction', sectionStart);

    expect(styleIdx).toBeGreaterThan(sectionStart);
    expect(styleIdx).toBeLessThan(constraintIdx);
  });

  it('若手ペルソナのシステムプロンプトに口語・疑問形スタイルが含まれる', async () => {
    await service.generateTurn(youngPersona, 'belief', 'interview', []);
    expect(mockCreate.mock.calls[0][0].system).toMatch(/口語|疑問形/);
  });

  it('経営者ペルソナのシステムプロンプトに断言的スタイルが含まれる', async () => {
    await service.generateTurn(executivePersona, 'belief', 'interview', []);
    expect(mockCreate.mock.calls[0][0].system).toMatch(/断言|謙遜|権威/);
  });

  it('若手と経営者ペルソナでシステムプロンプトの語り口指針が異なる', async () => {
    await service.generateTurn(youngPersona, 'belief', 'interview', []);
    const youngSystem: string = mockCreate.mock.calls[0][0].system;
    mockCreate.mockClear();

    await service.generateTurn(executivePersona, 'belief', 'interview', []);
    const execSystem: string = mockCreate.mock.calls[0][0].system;

    expect(youngSystem).not.toBe(execSystem);
  });

  it('TURN_TOOL の content フィールド説明に語り口スタイルが含まれる', async () => {
    await service.generateTurn(youngPersona, 'belief', 'interview', []);

    const tools = mockCreate.mock.calls[0][0].tools;
    const submitTurn = tools.find((t: { name: string }) => t.name === 'submit_turn');
    const contentDesc: string = submitTurn.input_schema.properties.content.description;

    expect(contentDesc).toMatch(/口語|疑問形|語り口/);
  });
});

describe('PersonaAgentService DI', () => {
  it('accepts injected Anthropic client via constructor', async () => {
    const injectedClient = { messages: { create: mockCreate } } as unknown as Anthropic;
    const service = new PersonaAgentService(injectedClient);
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'submit_turn', input: { content: '発言内容。' } }],
    });

    const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, testHistory);

    expect(result.ok).toBe(true);
  });
});

describe('PersonaAgentService', () => {
  let service: PersonaAgentService;

  beforeEach(() => {
    service = new PersonaAgentService();
  });

  describe('generateTurn — beliefChange 3ケース', () => {
    it('信念変化なし: beliefChange が null で content が返る', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_turn',
          input: {
            content: '医療安全の観点から、AI導入は適切なプロセスを経れば有益だと考えます。',
          },
        }],
      });

      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, testHistory);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBeTruthy();
      expect(result.value.beliefChange).toBeNull();
    });

    it('opinion_change: 完全な意見変化として BeliefChangeEvent が返る', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_turn',
          input: {
            content: '鈴木さんの話を聞いて、考えが変わりました。費用問題は深刻です。',
            beliefChangeType: 'opinion_change',
            beliefChangeSummary: '患者の経済的負担が医療安全より優先されるべきと認識を改めた',
            beliefChangeUpdatedBelief: '# 更新後の信念\n費用負担の問題を解決してから導入すべき。',
          },
        }],
      });

      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, testHistory);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.beliefChange).not.toBeNull();
      expect(result.value.beliefChange?.type).toBe('opinion_change');
      expect(result.value.beliefChange?.summary).toBeTruthy();
      expect(result.value.beliefChange?.updatedBelief).toBeTruthy();
    });

    it('partial_acceptance: 部分的承認として BeliefChangeEvent が返る', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_turn',
          input: {
            content: '山田さんのデータは興味深い。費用問題は残るが、安全性向上は認めます。',
            beliefChangeType: 'partial_acceptance',
            beliefChangeSummary: 'AI診断の安全性向上効果は認めるが、費用問題の解決が前提条件と認識した',
            beliefChangeUpdatedBelief: '# 更新後の信念\n安全性向上は評価するが、費用問題の解決を条件に支持。',
          },
        }],
      });

      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, testHistory);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.beliefChange).not.toBeNull();
      expect(result.value.beliefChange?.type).toBe('partial_acceptance');
    });
  });

  describe('generateTurn — addressedToPersonaId', () => {
    it('addressedToPersonaId あり: 特定ペルソナへの返答が返る', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_turn',
          input: {
            content: '鈴木さん、その費用の具体的な数字はどこから来ているのでしょうか？',
            addressedToPersonaId: 'p2',
          },
        }],
      });

      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, testHistory);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.addressedToPersonaId).toBe('p2');
      expect(result.value.beliefChange).toBeNull();
    });

    it('addressedToPersonaId なし: undefined が返る', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_turn',
          input: {
            content: 'データに基づいて判断することが重要です。',
          },
        }],
      });

      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, testHistory);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.addressedToPersonaId).toBeUndefined();
    });
  });

  describe('generateTurn — システムプロンプト検証', () => {
    it('システムプロンプトにペルソナ属性が含まれる', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_turn',
          input: { content: '発言内容。' },
        }],
      });

      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, testHistory);

      const call = mockCreate.mock.calls[0][0];
      expect(call.system).toMatch(/田中太郎/);
      expect(call.system).toMatch(/外科医/);
      expect(call.system).toMatch(/医師/);
    });

    it('システムプロンプトに取材レコードが含まれる', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_turn',
          input: { content: '発言内容。' },
        }],
      });

      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, testHistory);

      const call = mockCreate.mock.calls[0][0];
      expect(call.system).toMatch(/取材|インタビュー|interviewRecord/i);
      expect(call.system).toContain(testInterviewRecord);
    });

    it('システムプロンプトに現在の信念ドキュメントが含まれる', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_turn',
          input: { content: '発言内容。' },
        }],
      });

      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, testHistory);

      const call = mockCreate.mock.calls[0][0];
      expect(call.system).toContain(testCurrentBelief);
    });

    it('他ペルソナの取材レコード・信念はシステムプロンプトに含まれない', async () => {
      const otherPersonaBelief = '他のペルソナの秘密の信念ドキュメント_UNIQUE_STRING';
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_turn',
          input: { content: '発言内容。' },
        }],
      });

      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, testHistory);

      const call = mockCreate.mock.calls[0][0];
      expect(call.system).not.toContain(otherPersonaBelief);
    });
  });

  describe('generateTurn — エラーハンドリング', () => {
    it('Claude API 失敗時に error result を返す', async () => {
      mockCreate.mockRejectedValue(new Error('API rate limit exceeded'));

      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, testHistory);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('AI_API_ERROR');
    });

    it('エラーは retryable: true を返す', async () => {
      mockCreate.mockRejectedValue(new Error('network error'));

      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, testHistory);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({ code: 'AI_API_ERROR', retryable: true });
    });
  });

  describe('generateTurn - task 4: currentChapter コンテキスト', () => {
    it('currentChapter を指定すると user メッセージに章タイトルとフォーカス問いが含まれる', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'submit_turn', input: { content: '発言内容。' } }],
      });
      const currentChapter: DebateChapter = {
        index: 1,
        title: '核心的対立',
        focusQuestion: '最も意見が分かれる点はどこか？',
        startTurnIndex: 5,
      };

      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, testHistory, currentChapter);

      const msg: string = mockCreate.mock.calls[0][0].messages[0].content;
      expect(msg).toMatch(/核心的対立/);
      expect(msg).toMatch(/最も意見が分かれる点はどこか？/);
    });

    it('currentChapter を指定しても system プロンプトは変わらない', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'submit_turn', input: { content: '発言内容。' } }],
      });

      // Call without chapter
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, testHistory);
      const systemWithout: string = mockCreate.mock.calls[0][0].system;
      mockCreate.mockClear();

      // Call with chapter
      const currentChapter: DebateChapter = { index: 0, title: '導入', focusQuestion: '核心は？', startTurnIndex: 1 };
      await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, testHistory, currentChapter);
      const systemWith: string = mockCreate.mock.calls[0][0].system;

      expect(systemWith).toBe(systemWithout);
    });

    it('currentChapter なしでも動作する（後方互換性）', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'submit_turn', input: { content: '発言内容。' } }],
      });

      const result = await service.generateTurn(testPersona, testCurrentBelief, testInterviewRecord, testHistory);

      expect(result.ok).toBe(true);
    });
  });

  describe('generatePostDebateComment', () => {
    it('personaId と content を含む PostDebateCommentResult を返す', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_post_debate_comment',
          input: {
            content: '鈴木さんの費用負担への懸念は私が気づいていなかった視点でした。山田さんのデータは説得力がありましたが、やはり現場の課題解決が先だと思います。今日の議論を通じて、医師として患者の生活実態をもっと理解する必要があると感じました。',
          },
        }],
      });

      const result = await service.generatePostDebateComment(testPersona, testCurrentBelief, testHistory);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.personaId).toBe('p1');
      expect(result.value.content).toBeTruthy();
    });

    it('コメント内容が非空文字列である', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_post_debate_comment',
          input: { content: '今回の議論を通じて多くのことを学びました。' },
        }],
      });

      const result = await service.generatePostDebateComment(testPersona, testCurrentBelief, testHistory);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(typeof result.value.content).toBe('string');
      expect(result.value.content.length).toBeGreaterThan(0);
    });

    it('システムプロンプトにペルソナ属性が含まれる', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_post_debate_comment',
          input: { content: 'コメント内容。' },
        }],
      });

      await service.generatePostDebateComment(testPersona, testCurrentBelief, testHistory);

      const call = mockCreate.mock.calls[0][0];
      expect(call.system).toMatch(/田中太郎/);
    });

    it('Claude API 失敗時に error result を返す', async () => {
      mockCreate.mockRejectedValue(new Error('API error'));

      const result = await service.generatePostDebateComment(testPersona, testCurrentBelief, testHistory);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('AI_API_ERROR');
    });
  });
});
