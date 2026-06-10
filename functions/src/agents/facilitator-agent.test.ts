import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}));

import Anthropic from '@anthropic-ai/sdk';
import { FacilitatorAgentService } from './facilitator-agent.js';
import type { PersonaAttributes, ConversationTurn, DebateChapter } from '../types/index.js';

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
      expect(call.system).toMatch(/特定の立場への誘導は禁止/);
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
      expect(result.value.personaId).toBe('p2');
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
      expect(call.system).toMatch(/特定の立場への誘導は禁止/);
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

  describe('selectNextSpeaker - task 2.1: excludePersonaId オプション', () => {
    it('excludePersonaId 指定時、プロンプトに直前発言者の名前と除外指示が含まれる', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'select_speaker', input: { personaId: 'p2' } }],
      });

      await service.selectNextSpeaker(testHistory, testPersonas, new Map(), 'p1');

      const msg: string = mockCreate.mock.calls[0][0].messages[0].content;
      expect(msg).toMatch(/田中太郎/);
      expect(msg).toMatch(/選ばない/);
    });

    it('personas.length === 1 かつ excludePersonaId 指定時、除外ルール無視の旨がプロンプトに含まれる', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'select_speaker', input: { personaId: 'p1' } }],
      });

      await service.selectNextSpeaker(testHistory, [testPersonas[0]], new Map(), 'p1');

      const msg: string = mockCreate.mock.calls[0][0].messages[0].content;
      expect(msg).toMatch(/除外.*無視|無視.*除外|候補がない/);
    });

    it('excludePersonaId 未指定時、除外指示がプロンプトに含まれない', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'select_speaker', input: { personaId: 'p2' } }],
      });

      await service.selectNextSpeaker(testHistory, testPersonas, new Map());

      const msg: string = mockCreate.mock.calls[0][0].messages[0].content;
      expect(msg).not.toMatch(/選ばない/);
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

  describe('evaluateIntervention - task 2.2: speakCount 拡張', () => {
    it('speakCount 指定時、プロンプトに各ペルソナの累計発言数が含まれる', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_intervention', input: { shouldIntervene: false } }],
      });

      const speakCount = new Map([['p1', 5], ['p2', 2], ['p3', 0]]);
      await service.evaluateIntervention(testHistory, testPersonas, speakCount);

      const msg: string = mockCreate.mock.calls[0][0].messages[0].content;
      expect(msg).toMatch(/田中太郎.*5|5.*田中太郎/);
      expect(msg).toMatch(/山田次郎.*0|0.*山田次郎/);
    });

    it('speakCount 指定時、発言数の少ない人をinviteで優先する指示が含まれる', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_intervention', input: { shouldIntervene: false } }],
      });

      const speakCount = new Map([['p1', 3], ['p2', 1]]);
      await service.evaluateIntervention(testHistory, testPersonas, speakCount);

      const msg: string = mockCreate.mock.calls[0][0].messages[0].content;
      expect(msg).toMatch(/発言数.*優先|優先.*invite/);
    });

    it('shouldIntervene=false 時、speakCount があっても戻り値に影響しない', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_intervention', input: { shouldIntervene: false } }],
      });

      const speakCount = new Map([['p1', 10], ['p2', 0]]);
      const result = await service.evaluateIntervention(testHistory, testPersonas, speakCount);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.shouldIntervene).toBe(false);
      expect(result.value.content).toBeUndefined();
    });
  });

  describe('generateChapters - task 3.1', () => {
    const chapterResult = {
      chapters: [
        { title: '導入', focusQuestion: 'この問題の核心は何か？' },
        { title: '対立', focusQuestion: '最も意見が分かれる点は？' },
      ],
    };

    it('2回のAI呼び出しを経てDebateChapter[]を返す', async () => {
      mockCreate
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', name: 'submit_issues', input: { issues: ['論点1', '論点2', '論点3'] } }],
        })
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', name: 'submit_chapters', input: chapterResult }],
        });

      const result = await service.generateChapters('AI規制', testPersonas);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      expect(result.value[0].title).toBe('導入');
      expect(result.value[0].index).toBe(0);
      expect(result.value[1].index).toBe(1);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('Step 1（submit_issues）失敗時にPipelineErrorを返す', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API error'));

      const result = await service.generateChapters('AI規制', testPersonas);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('AI_API_ERROR');
    });

    it('Step 2（submit_chapters）失敗時にPipelineErrorを返す', async () => {
      mockCreate
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', name: 'submit_issues', input: { issues: ['論点1'] } }],
        })
        .mockRejectedValueOnce(new Error('Step 2 error'));

      const result = await service.generateChapters('AI規制', testPersonas);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('AI_API_ERROR');
    });

    it('Step 2 の user メッセージに Step 1 の論点が含まれる', async () => {
      mockCreate
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', name: 'submit_issues', input: { issues: ['論点X', '論点Y'] } }],
        })
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', name: 'submit_chapters', input: chapterResult }],
        });

      await service.generateChapters('AI規制', testPersonas);

      const step2Msg: string = mockCreate.mock.calls[1][0].messages[0].content;
      expect(step2Msg).toMatch(/論点X/);
      expect(step2Msg).toMatch(/論点Y/);
    });
  });

  describe('evaluateChapterEnd - task 3.2', () => {
    const testChapter: DebateChapter = { index: 0, title: '導入', focusQuestion: 'この問題の核心は何か？', startTurnIndex: 1 };

    it('shouldEnd=true の場合 Result<true> を返す', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_chapter_end', input: { shouldEnd: true } }],
      });

      const result = await service.evaluateChapterEnd(testHistory, testChapter);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(true);
    });

    it('shouldEnd=false の場合 Result<false> を返す', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_chapter_end', input: { shouldEnd: false } }],
      });

      const result = await service.evaluateChapterEnd(testHistory, testChapter);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(false);
    });

    it('AI エラー時に PipelineError を返す', async () => {
      mockCreate.mockRejectedValue(new Error('API error'));

      const result = await service.evaluateChapterEnd(testHistory, testChapter);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('AI_API_ERROR');
    });
  });

  describe('generateChapterSummary / generateChapterIntroduction - task 3.2', () => {
    const currentChapter: DebateChapter = { index: 0, title: '導入', focusQuestion: 'この問題の核心は何か？', startTurnIndex: 1 };
    const nextChapter: DebateChapter = { index: 1, title: '対立', focusQuestion: '最も意見が分かれる点は？', startTurnIndex: 8 };

    it('generateChapterSummary: 現章のまとめ発言テキストを返す', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'generate_chapter_transition', input: { content: '導入章のまとめです。' } }],
      });

      const result = await service.generateChapterSummary(testHistory, currentChapter);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(typeof result.value).toBe('string');
      expect(result.value.length).toBeGreaterThan(0);
    });

    it('generateChapterIntroduction: 次章の導入発言テキストとfirstPersonaIdを返す', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'submit_chapter_intro', input: { content: '次のテーマへ移ります。', firstPersonaId: 'p1' } }],
      });

      const result = await service.generateChapterIntroduction(nextChapter, testPersonas);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBeTruthy();
      expect(result.value.firstPersonaId).toBe('p1');
    });

    it('generateChapterSummary: AI エラー時に PipelineError を返す', async () => {
      mockCreate.mockRejectedValue(new Error('API error'));

      const result = await service.generateChapterSummary(testHistory, currentChapter);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('AI_API_ERROR');
    });
  });

  describe('generateOpening - task 3.3: firstChapter コンテキスト', () => {
    it('firstChapter を指定するとプロンプトに章タイトルとフォーカス問いが含まれる', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'submit_opening', input: { content: '開会します。', firstPersonaId: 'p1' } }],
      });
      const firstChapter: DebateChapter = { index: 0, title: '導入', focusQuestion: 'この問題の核心は何か？', startTurnIndex: 1 };

      await service.generateOpening('AI規制', testPersonas, firstChapter);

      const msg: string = mockCreate.mock.calls[0][0].messages[0].content;
      expect(msg).toMatch(/導入/);
      expect(msg).toMatch(/この問題の核心は何か？/);
    });

    it('firstChapter なしでも動作する（後方互換性）', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'submit_opening', input: { content: '開会します。', firstPersonaId: 'p1' } }],
      });

      const result = await service.generateOpening('AI規制', testPersonas);

      expect(result.ok).toBe(true);
    });
  });

  describe('evaluateIntervention - task 3.3: currentChapter コンテキスト', () => {
    it('currentChapter を指定するとプロンプトに章フォーカスが含まれる', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_intervention', input: { shouldIntervene: false } }],
      });
      const currentChapter: DebateChapter = { index: 1, title: '核心的対立', focusQuestion: '最も意見が分かれる点はどこか？', startTurnIndex: 5 };

      await service.evaluateIntervention(testHistory, testPersonas, new Map(), currentChapter);

      const msg: string = mockCreate.mock.calls[0][0].messages[0].content;
      expect(msg).toMatch(/核心的対立/);
      expect(msg).toMatch(/最も意見が分かれる点はどこか？/);
    });

    it('currentChapter なしでも動作する（後方互換性）', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'evaluate_intervention', input: { shouldIntervene: false } }],
      });

      const result = await service.evaluateIntervention(testHistory, testPersonas);

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
