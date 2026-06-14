import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DebateChapter } from '../types/index.js';

vi.mock('../db/repository.js', () => ({
  getTopicById: vi.fn(),
  getPersonasByTopicId: vi.fn(),
  getPersonaBeliefsByPersonaId: vi.fn(),
  getPersonaInterviewByPersonaId: vi.fn(),
  getDebateTurnsBySessionId: vi.fn(),
  getDebateSessionByTopicId: vi.fn(),
  createDebateTurn: vi.fn(),
  createPersonaBelief: vi.fn(),
  createPostDebateComment: vi.fn(),
  completeDebateSession: vi.fn(),
  updateTopicPhase: vi.fn(),
  isDebateActive: vi.fn(),
  finalizeTopicIfRunning: vi.fn(),
  saveChapters: vi.fn(),
  saveChapterIssues: vi.fn(),
  updateCurrentChapterIndex: vi.fn(),
  saveEngagements: vi.fn(),
  setPendingIntents: vi.fn(),
  loadPendingIntents: vi.fn(),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));

import * as repo from '../db/repository.js';
import { DebateOrchestratorService, DEFAULT_OPTIONS } from './debate-orchestrator.js';
import type { FacilitatorAgentService } from '../agents/facilitator-agent.js';
import type { PersonaAgentService } from '../agents/persona-agent.js';

// ---- helpers ----

const testPersonaProfiles = [
  { id: 'p1', topicId: 't1', stakeholderRole: '医師', name: '田中太郎', age: 45, occupation: '外科医', background: '30年経験', interests: '医療安全', stanceDirection: 'pro', approved: true, sortOrder: 0 },
  { id: 'p2', topicId: 't1', stakeholderRole: '患者', name: '鈴木花子', age: 35, occupation: '会社員', background: '患者歴10年', interests: '費用負担', stanceDirection: 'against', approved: true, sortOrder: 1 },
];

const p3Profile = {
  id: 'p3', topicId: 't1', stakeholderRole: '研究者', name: '山田次郎',
  age: 50, occupation: '大学教授', background: '経済学専攻', interests: '社会保障',
  stanceDirection: 'conditional', approved: true, sortOrder: 2,
};

const twoChapters: DebateChapter[] = [
  { index: 0, title: '導入', focusQuestion: 'この問題の核心は何か？', startTurnIndex: 0 },
  { index: 1, title: '核心的対立', focusQuestion: '最も意見が分かれる点はどこか？', startTurnIndex: 0 },
];

function makeMockFacilitator(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    generateOpening: vi.fn().mockResolvedValue({ ok: true, value: { content: '討論を始めます。', firstPersonaId: 'p1' } }),
    evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: false } }),
    generateClosing: vi.fn().mockResolvedValue({ ok: true, value: 'お疲れ様でした。' }),
    generateChapters: vi.fn().mockResolvedValue({ ok: true, value: { chapters: twoChapters, generalIssues: ['一般論点X'], personaIssues: ['ペルソナ論点Y'] } }),
    generateChapterSummary: vi.fn().mockResolvedValue({ ok: true, value: '章のまとめです。' }),
    generateChapterIntroduction: vi.fn().mockResolvedValue({ ok: true, value: { content: '次の章へ移ります。', firstPersonaId: 'p1' } }),
    ...overrides,
  } as unknown as FacilitatorAgentService;
}

function makeMockPersonaAgent(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    generateTurn: vi.fn().mockResolvedValue({ ok: true, value: { content: '私の意見です。', speechMode: 'full', beliefChange: null, addressedToPersonaId: undefined } }),
    // デフォルト: p1=score4/full, p2=score2/reaction で交互に発言が進む
    assessEngagement: vi.fn().mockImplementation(async (persona: { id: string }) => ({
      ok: true, value: { score: persona.id === 'p1' ? 4 : 2, mode: persona.id === 'p1' ? 'full' : 'reaction', intentSummary: undefined },
    })),
    generatePostDebateComment: vi.fn().mockImplementation(async (persona: { id: string }) => ({
      ok: true, value: { personaId: persona.id, content: '討論後のコメントです。' },
    })),
    ...overrides,
  } as unknown as PersonaAgentService;
}

function setupRepoDefaults() {
  vi.mocked(repo.getTopicById).mockResolvedValue({ id: 't1', title: 'AI医療診断の導入', createdAt: '', updatedAt: '' });
  vi.mocked(repo.getPersonasByTopicId).mockResolvedValue(testPersonaProfiles);
  vi.mocked(repo.getPersonaBeliefsByPersonaId).mockImplementation(async (personaId) => [
    { id: `belief-${personaId}`, personaId, version: 0, content: '# 初期信念\n賛成。', createdAt: '' },
  ]);
  vi.mocked(repo.getPersonaInterviewByPersonaId).mockImplementation(async (personaId) => ({
    id: `interview-${personaId}`, personaId, interviewRecord: '取材記録', status: 'completed', completedAt: '',
  }));
  vi.mocked(repo.createDebateTurn).mockResolvedValue({ id: 'turn-default' });
  vi.mocked(repo.createPersonaBelief).mockResolvedValue({ id: 'belief-new' });
  vi.mocked(repo.createPostDebateComment).mockResolvedValue({ id: 'comment-1' });
  vi.mocked(repo.completeDebateSession).mockResolvedValue(undefined);
  vi.mocked(repo.updateTopicPhase).mockResolvedValue(undefined);
  // 停止ゲート: 既定では討論アクティブ（phase=5, running 相当）
  vi.mocked(repo.isDebateActive).mockResolvedValue(true);
  vi.mocked(repo.finalizeTopicIfRunning).mockResolvedValue(true);
  vi.mocked(repo.getDebateTurnsBySessionId).mockResolvedValue([]);
  // 章立ては generateChaptersOnly で事前保存済み（executeChapterTask はこれを前提とする）
  vi.mocked(repo.getDebateSessionByTopicId).mockResolvedValue({
    id: 't1', topicId: 't1', createdAt: '',
    chapters: twoChapters.map(c => ({ index: c.index, title: c.title, focusQuestion: c.focusQuestion })),
    currentChapterIndex: 0,
  });
  vi.mocked(repo.saveChapters).mockResolvedValue(undefined);
  vi.mocked(repo.saveChapterIssues).mockResolvedValue(undefined);
  vi.mocked(repo.updateCurrentChapterIndex).mockResolvedValue(undefined);
  vi.mocked(repo.saveEngagements).mockResolvedValue(undefined);
  vi.mocked(repo.setPendingIntents).mockResolvedValue(undefined);
  vi.mocked(repo.loadPendingIntents).mockResolvedValue(new Map());
}

// 短い討論オプション: 毎評価ターンで介入チェック、章は2ターン（上限3ターン）で進む
const shortOptions = {
  turnsPerChapter: 2,
  maxTurns: 40,
  interventionCooldown: 0,
};

const personaTurnCalls = () =>
  vi.mocked(repo.createDebateTurn).mock.calls.filter(c => c[0].speakerType === 'persona');

beforeEach(() => {
  vi.clearAllMocks();
  setupRepoDefaults();
});

// ---- tests ----

describe('DebateOrchestratorService', () => {
  describe('generateChaptersOnly: 章立て事前生成', () => {
    it('章立てと切り口を生成して saveChapters・saveChapterIssues で保存する', async () => {
      const mockFacilitator = makeMockFacilitator();
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), shortOptions);

      await service.generateChaptersOnly('t1');

      expect(mockFacilitator.generateChapters).toHaveBeenCalledWith('AI医療診断の導入', expect.any(Array));
      expect(vi.mocked(repo.saveChapters)).toHaveBeenCalledWith('t1', [
        { index: 0, title: '導入', focusQuestion: 'この問題の核心は何か？' },
        { index: 1, title: '核心的対立', focusQuestion: '最も意見が分かれる点はどこか？' },
      ]);
      expect(vi.mocked(repo.saveChapterIssues)).toHaveBeenCalledWith('t1', ['一般論点X'], ['ペルソナ論点Y']);
    });

    it('章立て生成に失敗した場合はフォールバックせず例外を送出する', async () => {
      const mockFacilitator = makeMockFacilitator({
        generateChapters: vi.fn().mockResolvedValue({ ok: false, error: { code: 'AI_API_ERROR', message: 'chapter gen failed', retryable: true } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), shortOptions);

      await expect(service.generateChaptersOnly('t1')).rejects.toThrow('chapter gen failed');
      expect(vi.mocked(repo.saveChapters)).not.toHaveBeenCalled();
      expect(vi.mocked(repo.saveChapterIssues)).not.toHaveBeenCalled();
    });
  });

  describe('task 4.1: 章タスクの骨格と状態初期化', () => {
    it('DEFAULT_OPTIONS は turnsPerChapter / maxTurns / interventionCooldown のみを持つ', () => {
      expect(DEFAULT_OPTIONS).toEqual({ turnsPerChapter: 15, maxTurns: 200, interventionCooldown: 2 });
    });

    it('第1章開始時: 事前保存された章立てを前提にオープニング生成・保存（chapterIndex 0）で開始する', async () => {
      const mockFacilitator = makeMockFacilitator();
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), shortOptions);

      await service.executeChapterTask('t1', 0);

      // 章立て生成は generateChaptersOnly に分離済み。executeChapterTask 内では生成しない
      expect(mockFacilitator.generateChapters).not.toHaveBeenCalled();
      expect(mockFacilitator.generateOpening).toHaveBeenCalledWith(
        'AI医療診断の導入',
        expect.any(Array),
        expect.objectContaining({ index: 0 })
      );
      expect(vi.mocked(repo.createDebateTurn)).toHaveBeenCalledWith(
        expect.objectContaining({ turnIndex: 0, speakerType: 'facilitator', content: '討論を始めます。', chapterIndex: 0 })
      );
    });

    it('chapterIndex > 0 で章情報が存在しない場合は例外を送出する', async () => {
      vi.mocked(repo.getDebateSessionByTopicId).mockResolvedValue({ id: 't1', topicId: 't1', createdAt: '' });
      const service = new DebateOrchestratorService(makeMockFacilitator(), makeMockPersonaAgent(), shortOptions);

      await expect(service.executeChapterTask('t1', 1)).rejects.toThrow();
    });

    it('永続化済みキューを復元し、全員低意欲時にキュー保持者が full モードで発言する', async () => {
      vi.mocked(repo.getDebateSessionByTopicId).mockResolvedValue({
        id: 't1', topicId: 't1', createdAt: '',
        chapters: twoChapters.map(c => ({ index: c.index, title: c.title, focusQuestion: c.focusQuestion })),
        currentChapterIndex: 0,
      });
      vi.mocked(repo.getDebateTurnsBySessionId).mockResolvedValue([
        { id: 't0', sessionId: 't1', turnIndex: 0, speakerType: 'facilitator', content: '討論を始めます。', createdAt: '', chapterIndex: 0 },
      ]);
      vi.mocked(repo.loadPendingIntents).mockResolvedValue(new Map([
        ['p2', [{ triggerTurnIndex: 0, intentSummary: 'キューの意図' }]],
      ]));
      const mockPersonaAgent = makeMockPersonaAgent({
        assessEngagement: vi.fn().mockResolvedValue({ ok: true, value: { score: 2, mode: 'reaction', intentSummary: undefined } }),
      });
      const service = new DebateOrchestratorService(makeMockFacilitator(), mockPersonaAgent, shortOptions);

      await service.executeChapterTask('t1', 0);

      expect(vi.mocked(repo.loadPendingIntents)).toHaveBeenCalledWith('t1');
      const generateTurnCalls = (mockPersonaAgent.generateTurn as ReturnType<typeof vi.fn>).mock.calls;
      const queueCall = generateTurnCalls.find(c => (c[0] as { id: string }).id === 'p2');
      expect(queueCall).toBeDefined();
      expect(queueCall![3]).toMatchObject({ mode: 'full', intentSummary: 'キューの意図' });
    });

    it('トピックの停止ゲートが不成立なら何も生成せず false を返す', async () => {
      vi.mocked(repo.isDebateActive).mockResolvedValue(false);
      const mockFacilitator = makeMockFacilitator();
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), shortOptions);

      const hasNext = await service.executeChapterTask('t1', 0);

      expect(hasNext).toBe(false);
      expect(mockFacilitator.generateOpening).not.toHaveBeenCalled();
      expect(vi.mocked(repo.createDebateTurn)).not.toHaveBeenCalled();
    });

    it('処理済みの章（currentChapterIndex > chapterIndex）はスキップし次章有無を返す', async () => {
      vi.mocked(repo.getDebateSessionByTopicId).mockResolvedValue({
        id: 't1', topicId: 't1', createdAt: '',
        chapters: twoChapters.map(c => ({ index: c.index, title: c.title, focusQuestion: c.focusQuestion })),
        currentChapterIndex: 1,
      });
      const service = new DebateOrchestratorService(makeMockFacilitator(), makeMockPersonaAgent(), shortOptions);

      const hasNext = await service.executeChapterTask('t1', 0);

      expect(hasNext).toBe(true);
      expect(vi.mocked(repo.createDebateTurn)).not.toHaveBeenCalled();
    });

    it('章またぎの指名を復元する: 直前の章導入の addressedPersonaId のペルソナが章の最初の発言者になる', async () => {
      vi.mocked(repo.getDebateSessionByTopicId).mockResolvedValue({
        id: 't1', topicId: 't1', createdAt: '',
        chapters: twoChapters.map(c => ({ index: c.index, title: c.title, focusQuestion: c.focusQuestion })),
        currentChapterIndex: 1,
      });
      vi.mocked(repo.getDebateTurnsBySessionId).mockResolvedValue([
        { id: 't0', sessionId: 't1', turnIndex: 0, speakerType: 'facilitator', content: '討論を始めます。', createdAt: '', chapterIndex: 0 },
        { id: 't1t', sessionId: 't1', turnIndex: 1, speakerType: 'persona', personaId: 'p1', speakerName: '田中太郎', content: 'p1発言。', createdAt: '', chapterIndex: 0 },
        { id: 't2t', sessionId: 't1', turnIndex: 2, speakerType: 'facilitator', content: '章のまとめです。', createdAt: '', chapterIndex: 0 },
        { id: 't3t', sessionId: 't1', turnIndex: 3, speakerType: 'facilitator', content: '次の章を始めます。', createdAt: '', chapterIndex: 1, addressedPersonaId: 'p2' },
      ]);
      const mockPersonaAgent = makeMockPersonaAgent();
      const service = new DebateOrchestratorService(makeMockFacilitator(), mockPersonaAgent, shortOptions);

      await service.executeChapterTask('t1', 1);

      const generateTurnCalls = (mockPersonaAgent.generateTurn as ReturnType<typeof vi.fn>).mock.calls;
      expect(generateTurnCalls.length).toBeGreaterThanOrEqual(1);
      expect((generateTurnCalls[0][0] as { id: string }).id).toBe('p2');
      expect(generateTurnCalls[0][3]).toMatchObject({ nominatedByFacilitator: true, mode: 'full' });
    });
  });

  describe('task 4.2: ターンループ', () => {
    it('オープニングで指名された firstPersonaId が最初のペルソナ発言者になる（full・指名フラグ付き）', async () => {
      const mockPersonaAgent = makeMockPersonaAgent();
      const mockFacilitator = makeMockFacilitator({
        generateOpening: vi.fn().mockResolvedValue({ ok: true, value: { content: '開会。', firstPersonaId: 'p2' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, shortOptions);

      await service.executeChapterTask('t1', 0);

      const generateTurnCalls = (mockPersonaAgent.generateTurn as ReturnType<typeof vi.fn>).mock.calls;
      expect((generateTurnCalls[0][0] as { id: string }).id).toBe('p2');
      expect(generateTurnCalls[0][3]).toMatchObject({ nominatedByFacilitator: true, mode: 'full' });
    });

    it('addressedToPersonaId あり: 指名されたペルソナが次の発言者になる', async () => {
      const mockPersonaAgent = makeMockPersonaAgent({
        generateTurn: vi.fn()
          .mockResolvedValueOnce({ ok: true, value: { content: 'p1の発言。', speechMode: 'full', beliefChange: null, addressedToPersonaId: 'p2' } })
          .mockResolvedValue({ ok: true, value: { content: '発言。', speechMode: 'full', beliefChange: null, addressedToPersonaId: undefined } }),
      });
      const service = new DebateOrchestratorService(makeMockFacilitator(), mockPersonaAgent, shortOptions);

      await service.executeChapterTask('t1', 0);

      const generateTurnCalls = (mockPersonaAgent.generateTurn as ReturnType<typeof vi.fn>).mock.calls;
      expect(generateTurnCalls.length).toBeGreaterThanOrEqual(2);
      expect((generateTurnCalls[1][0] as { id: string }).id).toBe('p2');
    });

    it('次話者未確定のターンで意欲評価（直前話者を除く）と評価保存を行う', async () => {
      const mockPersonaAgent = makeMockPersonaAgent();
      const service = new DebateOrchestratorService(makeMockFacilitator(), mockPersonaAgent, shortOptions);

      await service.executeChapterTask('t1', 0);

      const assessCalls = (mockPersonaAgent.assessEngagement as ReturnType<typeof vi.fn>).mock.calls;
      expect(assessCalls.length).toBeGreaterThanOrEqual(1);
      expect(assessCalls[0][0].id).not.toBe('p1');
      expect(vi.mocked(repo.saveEngagements)).toHaveBeenCalled();
    });

    it('個別ペルソナの意欲評価失敗は score 1 として継続する', async () => {
      const mockPersonaAgent = makeMockPersonaAgent({
        assessEngagement: vi.fn().mockImplementation(async (persona: { id: string }) =>
          persona.id === 'p2'
            ? { ok: false, error: { code: 'AI_API_ERROR', message: 'assess failed', retryable: true } }
            : { ok: true, value: { score: 3, mode: 'full', intentSummary: undefined } }
        ),
      });
      const service = new DebateOrchestratorService(makeMockFacilitator(), mockPersonaAgent, shortOptions);

      await expect(service.executeChapterTask('t1', 0)).resolves.toBe(true);
      expect(personaTurnCalls().length).toBeGreaterThanOrEqual(2);
    });

    it('score 5 で選ばれなかったペルソナのキュー追加が setPendingIntents で永続化される', async () => {
      vi.mocked(repo.getPersonasByTopicId).mockResolvedValue([...testPersonaProfiles, p3Profile]);
      const mockPersonaAgent = makeMockPersonaAgent({
        assessEngagement: vi.fn().mockImplementation(async (persona: { id: string }) => {
          if (persona.id === 'p2') return { ok: true, value: { score: 5, mode: 'full', intentSummary: '言いたいこと' } };
          if (persona.id === 'p3') return { ok: true, value: { score: 5, mode: 'reaction', intentSummary: undefined } };
          return { ok: true, value: { score: 2, mode: 'reaction', intentSummary: undefined } };
        }),
      });
      const service = new DebateOrchestratorService(makeMockFacilitator(), mockPersonaAgent, shortOptions);

      await service.executeChapterTask('t1', 0);

      // p3 が緊急リアクションで選ばれ、p2（score 5・未選択）がキューに write-through される
      const queueWrites = vi.mocked(repo.setPendingIntents).mock.calls.filter(c => c[1] === 'p2');
      expect(queueWrites.length).toBeGreaterThanOrEqual(1);
      expect(queueWrites[0][2]).toEqual([
        expect.objectContaining({ intentSummary: '言いたいこと' }),
      ]);
    });

    it('キュー発言後に消費が setPendingIntents で永続化される', async () => {
      vi.mocked(repo.getDebateSessionByTopicId).mockResolvedValue({
        id: 't1', topicId: 't1', createdAt: '',
        chapters: twoChapters.map(c => ({ index: c.index, title: c.title, focusQuestion: c.focusQuestion })),
        currentChapterIndex: 0,
      });
      vi.mocked(repo.getDebateTurnsBySessionId).mockResolvedValue([
        { id: 't0', sessionId: 't1', turnIndex: 0, speakerType: 'facilitator', content: '討論を始めます。', createdAt: '', chapterIndex: 0 },
      ]);
      vi.mocked(repo.loadPendingIntents).mockResolvedValue(new Map([
        ['p2', [{ triggerTurnIndex: 0, intentSummary: 'キューの意図' }]],
      ]));
      const mockPersonaAgent = makeMockPersonaAgent({
        assessEngagement: vi.fn().mockResolvedValue({ ok: true, value: { score: 2, mode: 'reaction', intentSummary: undefined } }),
      });
      const service = new DebateOrchestratorService(makeMockFacilitator(), mockPersonaAgent, shortOptions);

      await service.executeChapterTask('t1', 0);

      // p2 のキュー消費（空配列の全置換書き込み）が発生する
      const consumeWrites = vi.mocked(repo.setPendingIntents).mock.calls.filter(
        c => c[1] === 'p2' && (c[2] as unknown[]).length === 0
      );
      expect(consumeWrites.length).toBeGreaterThanOrEqual(1);
    });

    it('invite 介入はファシリテーターターンとして chapterIndex・addressedPersonaId 付きで保存され、指名先が次話者になる', async () => {
      const mockPersonaAgent = makeMockPersonaAgent();
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn()
          .mockResolvedValueOnce({ ok: true, value: { shouldIntervene: true, type: 'invite', content: '鈴木さんはいかがですか？', targetPersonaId: 'p2' } })
          .mockResolvedValue({ ok: true, value: { shouldIntervene: false } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, shortOptions);

      await service.executeChapterTask('t1', 0);

      const interventionTurns = vi.mocked(repo.createDebateTurn).mock.calls.filter(
        c => c[0].speakerType === 'facilitator' && c[0].content === '鈴木さんはいかがですか？'
      );
      expect(interventionTurns).toHaveLength(1);
      expect(interventionTurns[0][0].chapterIndex).toBe(0);
      expect(interventionTurns[0][0].addressedPersonaId).toBe('p2');

      const generateTurnCalls = (mockPersonaAgent.generateTurn as ReturnType<typeof vi.fn>).mock.calls;
      const nominated = generateTurnCalls.find(c => (c[3] as { nominatedByFacilitator: boolean }).nominatedByFacilitator && (c[0] as { id: string }).id === 'p2');
      expect(nominated).toBeDefined();
    });

    it('invite 介入に targetPersonaId がない場合は指名せず評価ベースの選択に進む（名前マッチは行わない）', async () => {
      const mockPersonaAgent = makeMockPersonaAgent();
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn()
          .mockResolvedValueOnce({ ok: true, value: { shouldIntervene: true, type: 'invite', content: '鈴木花子さんはいかがですか？' } })
          .mockResolvedValue({ ok: true, value: { shouldIntervene: false } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, shortOptions);

      await service.executeChapterTask('t1', 0);

      // 本文に「鈴木花子」が含まれていても ID がなければ指名扱いにしない
      const generateTurnCalls = (mockPersonaAgent.generateTurn as ReturnType<typeof vi.fn>).mock.calls;
      const nominatedAfterIntervention = generateTurnCalls
        .slice(1) // 先頭はオープニング指名
        .filter(c => (c[3] as { nominatedByFacilitator: boolean }).nominatedByFacilitator);
      expect(nominatedAfterIntervention).toHaveLength(0);
    });

    it('オープニング・章導入の指名先が addressedPersonaId としてターンに保存される', async () => {
      const service = new DebateOrchestratorService(makeMockFacilitator(), makeMockPersonaAgent(), shortOptions);

      await service.executeChapterTask('t1', 0);

      const openingTurn = vi.mocked(repo.createDebateTurn).mock.calls.find(c => c[0].content === '討論を始めます。');
      expect(openingTurn?.[0].addressedPersonaId).toBe('p1');
      const introTurn = vi.mocked(repo.createDebateTurn).mock.calls.find(c => c[0].content === '次の章へ移ります。');
      expect(introTurn?.[0].addressedPersonaId).toBe('p1');
    });

    it('ペルソナの直接質問先が addressedPersonaId としてターンに保存される', async () => {
      const mockPersonaAgent = makeMockPersonaAgent({
        generateTurn: vi.fn()
          .mockResolvedValueOnce({ ok: true, value: { content: 'p1の発言。', speechMode: 'full', beliefChange: null, addressedToPersonaId: 'p2' } })
          .mockResolvedValue({ ok: true, value: { content: '発言。', speechMode: 'full', beliefChange: null, addressedToPersonaId: undefined } }),
      });
      const service = new DebateOrchestratorService(makeMockFacilitator(), mockPersonaAgent, shortOptions);

      await service.executeChapterTask('t1', 0);

      const p1Turn = vi.mocked(repo.createDebateTurn).mock.calls.find(c => c[0].content === 'p1の発言。');
      expect(p1Turn?.[0].addressedPersonaId).toBe('p2');
    });

    it('すべての保存ターンに chapterIndex が付与される', async () => {
      const service = new DebateOrchestratorService(makeMockFacilitator(), makeMockPersonaAgent(), shortOptions);

      await service.executeChapterTask('t1', 0);

      const allTurns = vi.mocked(repo.createDebateTurn).mock.calls;
      expect(allTurns.length).toBeGreaterThanOrEqual(4); // opening + persona + 遷移2ターン
      for (const [params] of allTurns) {
        expect(params.chapterIndex).toBeGreaterThanOrEqual(0);
      }
    });

    it('beliefChange が報告された場合 createPersonaBelief を version+1 と triggeredByTurnId で呼ぶ', async () => {
      const personaTurnId = 'p1-persona-turn-id';
      vi.mocked(repo.createDebateTurn)
        .mockResolvedValueOnce({ id: 'opening-turn-id' })
        .mockResolvedValueOnce({ id: personaTurnId })
        .mockResolvedValue({ id: 'turn-default' });
      const mockPersonaAgent = makeMockPersonaAgent({
        generateTurn: vi.fn()
          .mockResolvedValueOnce({
            ok: true,
            value: {
              content: 'p1の発言。',
              speechMode: 'full',
              beliefChange: { type: 'opinion_change', summary: '考えが変わった', updatedBelief: '# 更新後の信念\n反対に転じた。' },
              addressedToPersonaId: undefined,
            },
          })
          .mockResolvedValue({ ok: true, value: { content: '発言。', speechMode: 'full', beliefChange: null, addressedToPersonaId: undefined } }),
      });
      const service = new DebateOrchestratorService(makeMockFacilitator(), mockPersonaAgent, shortOptions);

      await service.executeChapterTask('t1', 0);

      expect(vi.mocked(repo.createPersonaBelief)).toHaveBeenCalledWith(
        expect.objectContaining({
          personaId: 'p1',
          version: 1,
          changeType: 'opinion_change',
          triggeredByTurnId: personaTurnId,
        })
      );
    });

    it('討論全体のターン上限（maxTurns）に達したらペルソナ発言を停止する', async () => {
      const service = new DebateOrchestratorService(
        makeMockFacilitator(),
        makeMockPersonaAgent(),
        { turnsPerChapter: 10, maxTurns: 3, interventionCooldown: 99 }
      );

      await service.executeChapterTask('t1', 0);

      // opening(idx0) + persona(idx1, idx2) で maxTurns=3 に到達し停止
      expect(personaTurnCalls().length).toBeLessThanOrEqual(2);
    });
  });

  describe('task 4.3: 章終了・章遷移・討論終端', () => {
    it('75%消化かつ直近5シグナル非活性で章を早期終了する', async () => {
      // turnsPerChapter=8 → 75%=6ターン・上限12ターン。全員低意欲で6ターン目に早期終了
      const mockFacilitator = makeMockFacilitator();
      const mockPersonaAgent = makeMockPersonaAgent({
        assessEngagement: vi.fn().mockResolvedValue({ ok: true, value: { score: 1, mode: 'none', intentSummary: undefined } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, { turnsPerChapter: 8, maxTurns: 40, interventionCooldown: 99 });

      await service.executeChapterTask('t1', 0);

      expect(personaTurnCalls()).toHaveLength(6);
      expect(mockFacilitator.generateChapterSummary).toHaveBeenCalledOnce();
    });

    it('章上限（150%）到達時に未応答の直接質問が残っていれば応答ターンを1件生成してから章を終える', async () => {
      // 全発言が相手への直接質問 → 連続交換上限(3)後も含め cap=3 で終了、未応答の指名に+1ターン
      const mockPersonaAgent = makeMockPersonaAgent({
        generateTurn: vi.fn().mockImplementation(async (persona: { id: string }) => ({
          ok: true,
          value: {
            content: '質問です。', speechMode: 'full', beliefChange: null,
            addressedToPersonaId: persona.id === 'p1' ? 'p2' : 'p1',
          },
        })),
      });
      const service = new DebateOrchestratorService(makeMockFacilitator(), mockPersonaAgent, shortOptions);

      await service.executeChapterTask('t1', 0);

      // cap(3) + 応答ターン1件 = 4
      const turns = personaTurnCalls();
      expect(turns).toHaveLength(4);
      // 3ターン目は p1（p2からの質問）→ 応答ターンは p2
      expect(turns[3][0].personaId).toBe('p2');
    });

    it('章遷移はまとめ（現章 index）と次章導入（次章 index）の2ターンを生成する', async () => {
      const mockFacilitator = makeMockFacilitator();
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), shortOptions);

      const hasNext = await service.executeChapterTask('t1', 0);

      expect(hasNext).toBe(true);
      const summaryTurn = vi.mocked(repo.createDebateTurn).mock.calls.find(c => c[0].content === '章のまとめです。');
      const introTurn = vi.mocked(repo.createDebateTurn).mock.calls.find(c => c[0].content === '次の章へ移ります。');
      expect(summaryTurn?.[0].chapterIndex).toBe(0);
      expect(introTurn?.[0].chapterIndex).toBe(1);
      expect(mockFacilitator.generateClosing).not.toHaveBeenCalled();
    });

    it('最終章後にクロージング（chapterIndex 付き）・事後コメント・セッション完了を行い false を返す', async () => {
      // 事前保存された章立てが単一章のケース（index 0 が最終章）
      vi.mocked(repo.getDebateSessionByTopicId).mockResolvedValue({
        id: 't1', topicId: 't1', createdAt: '',
        chapters: [{ index: 0, title: '導入', focusQuestion: 'この問題の核心は何か？' }],
        currentChapterIndex: 0,
      });
      const mockFacilitator = makeMockFacilitator();
      const mockPersonaAgent = makeMockPersonaAgent();
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, shortOptions);

      const hasNext = await service.executeChapterTask('t1', 0);

      expect(hasNext).toBe(false);
      expect(mockFacilitator.generateClosing).toHaveBeenCalledOnce();
      const closingTurn = vi.mocked(repo.createDebateTurn).mock.calls.find(c => c[0].content === 'お疲れ様でした。');
      expect(closingTurn?.[0].chapterIndex).toBe(0);
      expect(mockPersonaAgent.generatePostDebateComment).toHaveBeenCalledTimes(testPersonaProfiles.length);
      expect(vi.mocked(repo.completeDebateSession)).toHaveBeenCalledWith('t1', expect.any(Number));
      // 討論完了は「実行中のときのみ generated」で確定する（停止を上書きしない）
      expect(vi.mocked(repo.finalizeTopicIfRunning)).toHaveBeenCalledWith('t1');
    });
  });
});
