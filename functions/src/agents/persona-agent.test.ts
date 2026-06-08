import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}));

import Anthropic from '@anthropic-ai/sdk';
import { PersonaAgentService } from './persona-agent.js';
import type { PersonaAttributes, ConversationTurn } from '../types/index.js';

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
