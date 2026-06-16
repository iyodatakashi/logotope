import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}));

import Anthropic from '@anthropic-ai/sdk';
import { ChapterGeneratorService } from './chapter-generator.js';
import type { Persona } from '../../types/repository.types.js';
import type { Chapter } from '../../types/index.js';

const mockCreate = vi.fn();

const testPersonas: Persona[] = [
  { id: 'p1', topicId: 't1', stakeholderRole: '医師', specificRole: '外科医', name: '田中太郎', age: 45, occupation: '外科医', background: '30年の経験', interests: '医療安全', approved: true, sortOrder: 0 },
  { id: 'p2', topicId: 't1', stakeholderRole: '患者', specificRole: '患者', name: '鈴木花子', age: 35, occupation: '会社員', background: '慢性疾患あり', interests: '医療費負担', approved: true, sortOrder: 1 },
  { id: 'p3', topicId: 't1', stakeholderRole: '研究者', specificRole: '医療政策研究者', name: '山田次郎', age: 50, occupation: '大学教授', background: '医療政策専門', interests: '政策立案', approved: true, sortOrder: 2 },
];

const testHistory = [
  { id: 'h1', sessionId: 's1', turnIndex: 0, speakerType: 'facilitator' as const, speakerName: 'ファシリテーター', speakerRole: '', content: '討論を始めます。', createdAt: '' },
  { id: 'h2', sessionId: 's1', turnIndex: 1, speakerType: 'persona' as const, speakerName: '田中太郎', speakerRole: '医師', personaId: 'p1', content: '私はこの政策に賛成です。', createdAt: '' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Anthropic).mockImplementation(function (this: unknown) {
    return { messages: { create: mockCreate } } as unknown as Anthropic;
  });
});

describe('ChapterGeneratorService', () => {
  let service: ChapterGeneratorService;

  beforeEach(() => {
    service = new ChapterGeneratorService();
  });

  describe('generateChapters', () => {
    const chapterResult = {
      chapters: [
        { title: '導入', focusQuestion: 'この問題の核心は何か？' },
        { title: '対立', focusQuestion: '最も意見が分かれる点は？' },
      ],
    };

    // Step1 は一般切り口・ペルソナ固有切り口の2並列呼び出し、Step2 は章構造化の1呼び出し = 計3回
    const mockChapterFlow = (general: string[], persona: string[]) => {
      mockCreate
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', name: 'submit_issues', input: { issues: general } }],
        })
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', name: 'submit_issues', input: { issues: persona } }],
        })
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', name: 'submit_chapters', input: chapterResult }],
        });
    };

    it('切り口2並列（Step1）+ 章構造化（Step2）の計3回のAI呼び出しを経て章立てと切り口を返す', async () => {
      mockChapterFlow(['一般1', '一般2'], ['固有1', '固有2', '固有3']);

      const result = await service.generateChapters('AI規制', testPersonas);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.chapters).toHaveLength(2);
      expect(result.value.chapters[0].title).toBe('導入');
      expect(result.value.generalIssues).toEqual(['一般1', '一般2']);
      expect(result.value.personaIssues).toEqual(['固有1', '固有2', '固有3']);
      expect(mockCreate).toHaveBeenCalledTimes(3);
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
          content: [{ type: 'tool_use', name: 'submit_issues', input: { issues: ['一般1'] } }],
        })
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', name: 'submit_issues', input: { issues: ['固有1'] } }],
        })
        .mockRejectedValueOnce(new Error('Step 2 error'));

      const result = await service.generateChapters('AI規制', testPersonas);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('AI_API_ERROR');
    });

    it('Step 2 の user メッセージに Step 1 の一般・固有の両切り口が含まれる', async () => {
      mockChapterFlow(['一般X'], ['固有Y']);

      await service.generateChapters('AI規制', testPersonas);

      const step2Msg: string = mockCreate.mock.calls[2][0].messages[0].content;
      expect(step2Msg).toMatch(/一般X/);
      expect(step2Msg).toMatch(/固有Y/);
    });
  });

  describe('generateChapterSummary', () => {
    const currentChapter: Chapter = { title: '導入', focusQuestion: 'この問題の核心は何か？', startTurnIndex: 1 };

    it('現章のまとめ発言テキストを返す', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'generate_chapter_transition', input: { content: '導入章のまとめです。' } }],
      });

      const result = await service.generateChapterSummary(testHistory, currentChapter);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(typeof result.value).toBe('string');
      expect(result.value.length).toBeGreaterThan(0);
    });

    it('AI エラー時に PipelineError を返す', async () => {
      mockCreate.mockRejectedValue(new Error('API error'));

      const result = await service.generateChapterSummary(testHistory, currentChapter);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('AI_API_ERROR');
    });
  });

  describe('generateChapterIntroduction', () => {
    const nextChapter: Chapter = { title: '対立', focusQuestion: '最も意見が分かれる点は？', startTurnIndex: 8 };

    it('次章の導入発言テキストとtargetPersonaIdを返す', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'submit_chapter_intro', input: { content: '次のテーマへ移ります。', targetPersonaId: 'p1' } }],
      });

      const result = await service.generateChapterIntroduction(nextChapter, testPersonas);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBeTruthy();
      expect(result.value.targetPersonaId).toBe('p1');
    });
  });
});
