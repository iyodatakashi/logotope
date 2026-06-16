import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}));

import Anthropic from '@anthropic-ai/sdk';
import { FacilitatorAgentService } from './facilitator-agent.js';
import type { PersonaAttributes, ConversationTurn, DebateChapter } from '../types/index.js';

const mockCreate = vi.fn();

const testPersonas: PersonaAttributes[] = [
  { id: 'p1', stakeholderRole: '医師', name: '田中太郎', age: 45, occupation: '外科医', background: '30年の経験', interests: '医療安全' },
  { id: 'p2', stakeholderRole: '患者', name: '鈴木花子', age: 35, occupation: '会社員', background: '慢性疾患あり', interests: '医療費負担' },
  { id: 'p3', stakeholderRole: '研究者', name: '山田次郎', age: 50, occupation: '大学教授', background: '医療政策専門', interests: '政策立案' },
];

const testHistory: ConversationTurn[] = [
  { turnId: 't1', turnIndex: 0, speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '', content: '討論を始めます。' },
  { turnId: 't2', turnIndex: 1, speakerType: 'persona', speakerName: '田中太郎', speakerRole: '医師', content: '私はこの政策に賛成です。' },
  { turnId: 't3', turnIndex: 2, speakerType: 'persona', speakerName: '鈴木花子', speakerRole: '患者', content: '患者としては不安があります。' },
];

beforeEach(() => {
  vi.clearAllMocks();
  // コンストラクタとして new されるため、アロー関数ではなく function 式でモックする（vitest 4）
  vi.mocked(Anthropic).mockImplementation(function (this: unknown) {
    return { messages: { create: mockCreate } } as unknown as Anthropic;
  });
});

describe('FacilitatorAgentService DI', () => {
  it('accepts injected Anthropic client via constructor', async () => {
    const injectedClient = { messages: { create: mockCreate } } as unknown as Anthropic;
    const service = new FacilitatorAgentService(injectedClient);
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'submit_opening', input: { content: '開会します。', targetPersonaId: 'p1' } }],
    });

    const result = await service.generateOpening('AI規制', testPersonas);

    expect(result.ok).toBe(true);
  });
});

describe('FacilitatorAgentService', () => {
  let service: FacilitatorAgentService;

  beforeEach(() => {
    service = new FacilitatorAgentService();
  });

  describe('generateOpening', () => {
    it('returns ok with content and targetPersonaId', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_opening',
          input: { content: '本日はAI規制について多角的に討論します。', targetPersonaId: 'p1' },
        }],
      });

      const result = await service.generateOpening('AI規制', testPersonas);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBeTruthy();
      expect(result.value.targetPersonaId).toBe('p1');
    });

    it('targetPersonaId is one of the provided persona ids', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_opening',
          input: { content: '開会します。', targetPersonaId: 'p2' },
        }],
      });

      const result = await service.generateOpening('AI規制', testPersonas);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const personaIds = testPersonas.map(p => p.id);
      expect(personaIds).toContain(result.value.targetPersonaId);
    });

    it('system prompt contains neutrality constraint', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_opening',
          input: { content: '開会します。', targetPersonaId: 'p1' },
        }],
      });

      await service.generateOpening('AI規制', testPersonas);

      const call = mockCreate.mock.calls[0][0];
      expect(call.system).toMatch(/特定の立場への誘導は禁止/);
    });

    it('neutrality constraint forbids inducement to specific conclusions', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_opening',
          input: { content: '開会します。', targetPersonaId: 'p1' },
        }],
      });

      await service.generateOpening('AI規制', testPersonas);

      const call = mockCreate.mock.calls[0][0];
      expect(call.system).toMatch(/誘導.*(禁止|しない)|禁止.*誘導/);
    });

    it('returns error result when Claude API fails', async () => {
      mockCreate.mockRejectedValue(new Error('API rate limit'));

      const result = await service.generateOpening('AI規制', testPersonas);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('AI_API_ERROR');
    });

    it('returns retryable error on API failure', async () => {
      mockCreate.mockRejectedValue(new Error('network error'));

      const result = await service.generateOpening('AI規制', testPersonas);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({ code: 'AI_API_ERROR', retryable: true });
    });
  });

  describe('task 1.2: 未使用メソッドの削除', () => {
    it('selectNextSpeaker / evaluateChapterEnd が存在しない', () => {
      expect('selectNextSpeaker' in service).toBe(false);
      expect('evaluateChapterEnd' in service).toBe(false);
    });
  });

  describe('evaluateIntervention', () => {
    it('介入なしの場合 content と targetPersonaId は undefined', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'evaluate_intervention',
          input: {},
        }],
      });

      const result = await service.evaluateStallIntervention(testHistory, testPersonas);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBeUndefined();
      expect(result.value.targetPersonaId).toBeUndefined();
    });

    it('介入ありの場合 content と targetPersonaId を返す', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'evaluate_intervention',
          input: { content: '山田さん、研究者の観点からいかがですか？', targetPersonaId: 'p3' },
        }],
      });

      const result = await service.evaluateStallIntervention(testHistory, testPersonas);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBeTruthy();
      expect(result.value.targetPersonaId).toBe('p3');
    });

    it('returns error result when Claude API fails', async () => {
      mockCreate.mockRejectedValue(new Error('API error'));

      const result = await service.evaluateStallIntervention(testHistory, testPersonas);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('AI_API_ERROR');
    });
  });

  describe('evaluateTopicDrift（論点ずれ判定）', () => {
    it('プロンプトは論点逸脱のみを判定し、出尽くしには言及しない', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_intervention', input: {} }],
      });

      await service.evaluateTopicDrift(testHistory, testPersonas);

      const msg: string = mockCreate.mock.calls[0][0].messages[0].content;
      expect(msg).toMatch(/逸脱/);
      expect(msg).not.toMatch(/出尽くし/);
    });

    it('逸脱時は content と targetPersonaId を返す', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'evaluate_intervention',
          input: { content: '山田さん、本題に戻すと？', targetPersonaId: 'p3' },
        }],
      });

      const result = await service.evaluateTopicDrift(testHistory, testPersonas);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBeTruthy();
      expect(result.value.targetPersonaId).toBe('p3');
    });
  });

  describe('evaluateIntervention - task 2.2: speakCount 拡張', () => {
    it('speakCount 指定時、プロンプトに各ペルソナの累計発言数が含まれる', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_intervention', input: {} }],
      });

      const speakCount = new Map([['p1', 5], ['p2', 2], ['p3', 0]]);
      await service.evaluateStallIntervention(testHistory, testPersonas, speakCount);

      const msg: string = mockCreate.mock.calls[0][0].messages[0].content;
      expect(msg).toMatch(/田中太郎.*5|5.*田中太郎/);
      expect(msg).toMatch(/山田次郎.*0|0.*山田次郎/);
    });

    it('speakCount 指定時、発言数の少ない人をinviteで優先する指示が含まれる', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_intervention', input: {} }],
      });

      const speakCount = new Map([['p1', 3], ['p2', 1]]);
      await service.evaluateStallIntervention(testHistory, testPersonas, speakCount);

      const msg: string = mockCreate.mock.calls[0][0].messages[0].content;
      expect(msg).toMatch(/発言数.*優先|優先.*invite/);
    });

    it('介入なし時、speakCount があっても戻り値に影響しない', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_intervention', input: {} }],
      });

      const speakCount = new Map([['p1', 10], ['p2', 0]]);
      const result = await service.evaluateStallIntervention(testHistory, testPersonas, speakCount);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBeUndefined();
    });
  });

  describe('evaluateIntervention - 介入は常に論点提示＋指名に一本化', () => {
    it('ツールスキーマに type 分岐がなく targetPersonaId を持つ', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_intervention', input: {} }],
      });

      await service.evaluateStallIntervention(testHistory, testPersonas);

      const tools = mockCreate.mock.calls[0][0].tools;
      const properties = tools[0].input_schema.properties;
      expect(properties.type).toBeUndefined();
      expect(properties.targetPersonaId).toBeDefined();
    });

    it('ツールスキーマで targetPersonaId が content より先に定義される（指名先を決めてから発言を書く生成順）', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_intervention', input: {} }],
      });

      await service.evaluateStallIntervention(testHistory, testPersonas);

      const properties = mockCreate.mock.calls[0][0].tools[0].input_schema.properties;
      const keys = Object.keys(properties);
      expect(keys.indexOf('targetPersonaId')).toBeGreaterThanOrEqual(0);
      expect(keys.indexOf('targetPersonaId')).toBeLessThan(keys.indexOf('content'));
      // content は指名先に名前で呼びかける指示を含む
      expect(properties.content.description).toMatch(/呼びかけ/);
    });

    it('プロンプトに「先にIDを決めてから content を書く」手順が含まれる', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_intervention', input: {} }],
      });

      await service.evaluateStallIntervention(testHistory, testPersonas);

      const msg: string = mockCreate.mock.calls[0][0].messages[0].content;
      expect(msg).toMatch(/targetPersonaId/);
      expect(msg).toMatch(/名前で呼びかけ/);
    });

    it('プロンプトに close への言及がなく、章終了の判断を求めない', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_intervention', input: {} }],
      });

      await service.evaluateStallIntervention(testHistory, testPersonas);

      const msg: string = mockCreate.mock.calls[0][0].messages[0].content;
      expect(msg).not.toMatch(/close/);
      expect(msg).not.toMatch(/章を終了|章の終了/);
    });

  });

  describe('generateOpening - task 3.3: firstChapter コンテキスト', () => {
    it('firstChapter を指定するとプロンプトに章タイトルとフォーカス問いが含まれる', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'submit_opening', input: { content: '開会します。', targetPersonaId: 'p1' } }],
      });
      const firstChapter: DebateChapter = { index: 0, title: '導入', focusQuestion: 'この問題の核心は何か？', startTurnIndex: 1 };

      await service.generateOpening('AI規制', testPersonas, firstChapter);

      const msg: string = mockCreate.mock.calls[0][0].messages[0].content;
      expect(msg).toMatch(/導入/);
      expect(msg).toMatch(/この問題の核心は何か？/);
    });

    it('firstChapter なしでも動作する（後方互換性）', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'submit_opening', input: { content: '開会します。', targetPersonaId: 'p1' } }],
      });

      const result = await service.generateOpening('AI規制', testPersonas);

      expect(result.ok).toBe(true);
    });
  });

  describe('evaluateIntervention - task 3.3: currentChapter コンテキスト', () => {
    it('currentChapter を指定するとプロンプトに章フォーカスが含まれる', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_intervention', input: {} }],
      });
      const currentChapter: DebateChapter = { index: 1, title: '核心的対立', focusQuestion: '最も意見が分かれる点はどこか？', startTurnIndex: 5 };

      await service.evaluateStallIntervention(testHistory, testPersonas, new Map(), currentChapter);

      const msg: string = mockCreate.mock.calls[0][0].messages[0].content;
      expect(msg).toMatch(/核心的対立/);
      expect(msg).toMatch(/最も意見が分かれる点はどこか？/);
    });

    it('currentChapter なしでも動作する（後方互換性）', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_intervention', input: {} }],
      });

      const result = await service.evaluateStallIntervention(testHistory, testPersonas);

      expect(result.ok).toBe(true);
    });
  });

  describe('generateClosing', () => {
    it('returns ok with non-empty closing content', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_closing',
          input: { content: '本日は活発な議論をいただきありがとうございました。様々な立場から貴重なご意見をいただきました。' },
        }],
      });

      const finalBeliefs = new Map([
        ['p1', '# 最終信念\n医療の安全性確保が最優先。'],
        ['p2', '# 最終信念\n患者負担軽減が必要。'],
      ]);

      const result = await service.generateClosing(testHistory, finalBeliefs);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(typeof result.value).toBe('string');
      expect(result.value.length).toBeGreaterThan(0);
    });

    it('system prompt contains neutrality constraint', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_closing',
          input: { content: 'ありがとうございました。' },
        }],
      });

      await service.generateClosing(testHistory, new Map());

      const call = mockCreate.mock.calls[0][0];
      expect(call.system).toMatch(/特定の立場への誘導は禁止/);
    });

    it('returns error result when Claude API fails', async () => {
      mockCreate.mockRejectedValue(new Error('API error'));

      const result = await service.generateClosing(testHistory, new Map());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('AI_API_ERROR');
    });
  });
});
