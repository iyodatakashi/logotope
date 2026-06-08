import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}));

import Anthropic from '@anthropic-ai/sdk';
import { FacilitatorAgentService } from './facilitator-agent.js';
import type { PersonaAttributes, ConversationTurn } from '../types/index.js';

const mockCreate = vi.fn();

const testPersonas: PersonaAttributes[] = [
  { id: 'p1', stakeholderRole: '医師', name: '田中太郎', age: 45, occupation: '外科医', background: '30年の経験', interests: '医療安全', stanceDirection: 'pro' },
  { id: 'p2', stakeholderRole: '患者', name: '鈴木花子', age: 35, occupation: '会社員', background: '慢性疾患あり', interests: '医療費負担', stanceDirection: 'against' },
  { id: 'p3', stakeholderRole: '研究者', name: '山田次郎', age: 50, occupation: '大学教授', background: '医療政策専門', interests: '政策立案', stanceDirection: 'conditional' },
];

const testHistory: ConversationTurn[] = [
  { turnId: 't1', turnIndex: 0, speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '', content: '討論を始めます。' },
  { turnId: 't2', turnIndex: 1, speakerType: 'persona', speakerName: '田中太郎', speakerRole: '医師', content: '私はこの政策に賛成です。' },
  { turnId: 't3', turnIndex: 2, speakerType: 'persona', speakerName: '鈴木花子', speakerRole: '患者', content: '患者としては不安があります。' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Anthropic).mockImplementation(() => ({
    messages: { create: mockCreate },
  }) as unknown as Anthropic);
});

describe('FacilitatorAgentService DI', () => {
  it('accepts injected Anthropic client via constructor', async () => {
    const injectedClient = { messages: { create: mockCreate } } as unknown as Anthropic;
    const service = new FacilitatorAgentService(injectedClient);
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'submit_opening', input: { content: '開会します。', firstPersonaId: 'p1' } }],
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
    it('returns ok with content and firstPersonaId', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_opening',
          input: { content: '本日はAI規制について多角的に討論します。', firstPersonaId: 'p1' },
        }],
      });

      const result = await service.generateOpening('AI規制', testPersonas);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBeTruthy();
      expect(result.value.firstPersonaId).toBe('p1');
    });

    it('firstPersonaId is one of the provided persona ids', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_opening',
          input: { content: '開会します。', firstPersonaId: 'p2' },
        }],
      });

      const result = await service.generateOpening('AI規制', testPersonas);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const personaIds = testPersonas.map(p => p.id);
      expect(personaIds).toContain(result.value.firstPersonaId);
    });

    it('system prompt contains neutrality constraint', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_opening',
          input: { content: '開会します。', firstPersonaId: 'p1' },
        }],
      });

      await service.generateOpening('AI規制', testPersonas);

      const call = mockCreate.mock.calls[0][0];
      expect(call.system).toMatch(/中立/);
    });

    it('neutrality constraint forbids inducement to specific conclusions', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'submit_opening',
          input: { content: '開会します。', firstPersonaId: 'p1' },
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

  describe('selectNextSpeaker', () => {
    it('returns ok with a personaId string', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'select_speaker',
          input: { personaId: 'p2' },
        }],
      });

      const result = await service.selectNextSpeaker(testHistory, testPersonas, new Map([['p1', 2], ['p2', 0]]));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(typeof result.value).toBe('string');
      expect(result.value).toBe('p2');
    });

    it('system prompt contains neutrality constraint', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'select_speaker',
          input: { personaId: 'p3' },
        }],
      });

      await service.selectNextSpeaker(testHistory, testPersonas, new Map());

      const call = mockCreate.mock.calls[0][0];
      expect(call.system).toMatch(/中立/);
    });

    it('passes silence map info to the API', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'select_speaker',
          input: { personaId: 'p3' },
        }],
      });

      const silenceMap = new Map([['p3', 5]]);
      await service.selectNextSpeaker(testHistory, testPersonas, silenceMap);

      const call = mockCreate.mock.calls[0][0];
      const userMessage = call.messages[0].content;
      expect(userMessage).toMatch(/山田次郎.*5|5.*山田次郎/);
    });

    it('returns error result when Claude API fails', async () => {
      mockCreate.mockRejectedValue(new Error('API error'));

      const result = await service.selectNextSpeaker(testHistory, testPersonas, new Map());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('AI_API_ERROR');
    });
  });

  describe('evaluateIntervention', () => {
    it('when shouldIntervene=false, content is undefined', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'evaluate_intervention',
          input: { shouldIntervene: false },
        }],
      });

      const result = await service.evaluateIntervention(testHistory, testPersonas);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.shouldIntervene).toBe(false);
      expect(result.value.content).toBeUndefined();
      expect(result.value.type).toBeUndefined();
    });

    it('when shouldIntervene=true with invite, returns type and content', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'evaluate_intervention',
          input: { shouldIntervene: true, type: 'invite', content: '山田さん、研究者の観点からいかがですか？', targetPersonaId: 'p3' },
        }],
      });

      const result = await service.evaluateIntervention(testHistory, testPersonas);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.shouldIntervene).toBe(true);
      expect(result.value.type).toBe('invite');
      expect(result.value.content).toBeTruthy();
      expect(result.value.targetPersonaId).toBe('p3');
    });

    it('when shouldIntervene=true with topic_shift, type is valid', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'evaluate_intervention',
          input: { shouldIntervene: true, type: 'topic_shift', content: '経済的な側面からも考えてみましょう。' },
        }],
      });

      const result = await service.evaluateIntervention(testHistory, testPersonas);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const validTypes = ['topic_shift', 'invite', 'close'];
      expect(validTypes).toContain(result.value.type);
    });

    it('when shouldIntervene=true with close, content is included', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'tool_use',
          name: 'evaluate_intervention',
          input: { shouldIntervene: true, type: 'close', content: '活発な議論をいただきありがとうございました。' },
        }],
      });

      const result = await service.evaluateIntervention(testHistory, testPersonas);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.type).toBe('close');
      expect(result.value.content).toBeTruthy();
    });

    it('returns error result when Claude API fails', async () => {
      mockCreate.mockRejectedValue(new Error('API error'));

      const result = await service.evaluateIntervention(testHistory, testPersonas);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('AI_API_ERROR');
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
      expect(call.system).toMatch(/中立/);
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
