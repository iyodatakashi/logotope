import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldEvaluateIntervention, evaluateParticipationBalance, DEFAULT_OPTIONS, DEFAULT_CHAPTERS } from './debate-orchestrator.js';
import type { DebateChapter } from '../types/index.js';

vi.mock('../db/repository.js', () => ({
  getTopicById: vi.fn(),
  getPersonasByTopicId: vi.fn(),
  getPersonaBeliefsByPersonaId: vi.fn(),
  getPersonaInterviewByPersonaId: vi.fn(),
  getDebateTurnsBySessionId: vi.fn(),
  getDebateSessionById: vi.fn(),
  createDebateTurn: vi.fn(),
  createPersonaBelief: vi.fn(),
  createPostDebateComment: vi.fn(),
  completeDebateSession: vi.fn(),
  updateTopicStatus: vi.fn(),
  saveChapters: vi.fn(),
  updateCurrentChapterIndex: vi.fn(),
  saveEngagements: vi.fn(),
  consumePendingIntent: vi.fn(),
  loadPendingIntents: vi.fn(),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));

import * as repo from '../db/repository.js';
import { DebateOrchestratorService } from './debate-orchestrator.js';
import type { DebateState } from './debate-orchestrator.js';
import type { FacilitatorAgentService } from '../agents/facilitator-agent.js';
import type { PersonaAgentService } from '../agents/persona-agent.js';
import type { ProgressTrackerService } from './progress-tracker.js';

// ---- helpers ----

const testPersonaProfiles = [
  { id: 'p1', topicId: 't1', stakeholderRole: '医師', name: '田中太郎', age: 45, occupation: '外科医', background: '30年経験', interests: '医療安全', stanceDirection: 'pro', approved: true, sortOrder: 0 },
  { id: 'p2', topicId: 't1', stakeholderRole: '患者', name: '鈴木花子', age: 35, occupation: '会社員', background: '患者歴10年', interests: '費用負担', stanceDirection: 'against', approved: true, sortOrder: 1 },
];

function makeMockFacilitator(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    generateOpening: vi.fn().mockResolvedValue({ ok: true, value: { content: '討論を始めます。', firstPersonaId: 'p1' } }),
    evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: false } }),
    generateClosing: vi.fn().mockResolvedValue({ ok: true, value: 'お疲れ様でした。' }),
    generateChapters: vi.fn().mockResolvedValue({ ok: false, error: { code: 'AI_API_ERROR', message: 'mock', retryable: true } }),
    generateChapterSummary: vi.fn().mockResolvedValue({ ok: true, value: '章のまとめです。' }),
    generateChapterIntroduction: vi.fn().mockResolvedValue({ ok: true, value: '次の章へ移ります。' }),
    ...overrides,
  } as unknown as FacilitatorAgentService;
}

function makeMockPersonaAgent(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    generateTurn: vi.fn().mockResolvedValue({ ok: true, value: { content: '私の意見です。', beliefChange: null, addressedToPersonaId: undefined } }),
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

function makeMockTracker() {
  return {
    updateStatus: vi.fn().mockResolvedValue(undefined),
    updateProgress: vi.fn().mockResolvedValue(undefined),
    setError: vi.fn().mockResolvedValue(undefined),
    debugLog: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProgressTrackerService;
}

function setupRepoDefaults() {
  vi.mocked(repo.getTopicById).mockResolvedValue({ id: 't1', title: 'AI医療診断の導入', status: 'debating', createdAt: '', updatedAt: '' });
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
  vi.mocked(repo.updateTopicStatus).mockResolvedValue(undefined);
  vi.mocked(repo.getDebateTurnsBySessionId).mockResolvedValue([]);
  vi.mocked(repo.getDebateSessionById).mockResolvedValue({ id: 'session-1', topicId: 't1', status: 'running', createdAt: '' });
  vi.mocked(repo.saveChapters).mockResolvedValue(undefined);
  vi.mocked(repo.updateCurrentChapterIndex).mockResolvedValue(undefined);
  vi.mocked(repo.saveEngagements).mockResolvedValue(undefined);
  vi.mocked(repo.consumePendingIntent).mockResolvedValue(undefined);
  vi.mocked(repo.loadPendingIntents).mockResolvedValue(new Map());
}

// Short debate options for tests: check intervention every turn, accept 1 speak per persona
const shortOptions = {
  turnsPerChapter: 10,
  maxTurns: 40,
  interventionInterval: 1,
  silenceThreshold: 100,
  minTurnsPerPersona: 1,
  minSpeaksPerPersonaInChapter: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  setupRepoDefaults();
});

// ---- tests ----

describe('DebateOrchestratorService', () => {
  describe('run — 冒頭発言', () => {
    it('generateOpening を呼び出し、冒頭ターンを facilitator として保存する', async () => {
      const mockFacilitator = makeMockFacilitator({
        // evaluateIntervention returns close immediately (but min-turns check will gate it)
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: 'クロージング。' } }),
      });
      const mockPersonaAgent = makeMockPersonaAgent();
      const mockTracker = makeMockTracker();
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, mockTracker, shortOptions);

      await service.run('session-1', 't1');

      expect(mockFacilitator.generateOpening).toHaveBeenCalledWith(
        'AI医療診断の導入',
        expect.any(Array),
        expect.objectContaining({ index: 0, title: '導入' })
      );
      expect(vi.mocked(repo.createDebateTurn)).toHaveBeenCalledWith(
        expect.objectContaining({ turnIndex: 0, speakerType: 'facilitator', content: '討論を始めます。' })
      );
    });
  });

  describe('run — 次話者決定', () => {
    it('addressedToPersonaId あり: 指名されたペルソナ(p2)が2番目の発言者になる', async () => {
      // p1's turn returns addressedToPersonaId='p2' → p2 speaks next directly
      const mockPersonaAgent = makeMockPersonaAgent({
        generateTurn: vi.fn()
          .mockResolvedValueOnce({ ok: true, value: { content: 'p1の発言。', beliefChange: null, addressedToPersonaId: 'p2' } })
          .mockResolvedValue({ ok: true, value: { content: 'p2の発言。', beliefChange: null, addressedToPersonaId: undefined } }),
      });
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: 'クロージング。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      // The second generateTurn call should be for p2 (direct addressing from p1's turn)
      const generateTurnCalls = (mockPersonaAgent.generateTurn as ReturnType<typeof vi.fn>).mock.calls;
      expect(generateTurnCalls.length).toBeGreaterThanOrEqual(2);
      expect((generateTurnCalls[1][0] as { id: string }).id).toBe('p2');
    });

    it('addressedToPersonaId なし: assessEngagement を呼んで次話者を決定する', async () => {
      const mockPersonaAgent = makeMockPersonaAgent();
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: 'クロージング。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      // After p1's turn (no addressedTo), assessEngagement is called for speaker selection
      expect(mockPersonaAgent.assessEngagement).toHaveBeenCalled();
    });
  });

  describe('run — 信念変化', () => {
    it('beliefChange が null でない場合、createPersonaBelief を version+1 と triggeredByTurnId で呼ぶ', async () => {
      const personaTurnId = 'p1-persona-turn-id';
      vi.mocked(repo.createDebateTurn)
        .mockResolvedValueOnce({ id: 'opening-turn-id' })   // opening
        .mockResolvedValueOnce({ id: personaTurnId });       // p1's turn

      const mockPersonaAgent = makeMockPersonaAgent({
        generateTurn: vi.fn()
          .mockResolvedValueOnce({
            ok: true,
            value: {
              content: 'p1の発言。',
              beliefChange: {
                type: 'opinion_change',
                summary: '考えが変わった',
                updatedBelief: '# 更新後の信念\n反対に転じた。',
              },
              addressedToPersonaId: 'p2',
            },
          })
          .mockResolvedValue({ ok: true, value: { content: 'p2の発言。', beliefChange: null, addressedToPersonaId: undefined } }),
      });
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: 'クロージング。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      expect(vi.mocked(repo.createPersonaBelief)).toHaveBeenCalledWith(
        expect.objectContaining({
          personaId: 'p1',
          version: 1,               // 0 → 1
          changeType: 'opinion_change',
          changeSummary: '考えが変わった',
          triggeredByTurnId: personaTurnId,
        })
      );
    });

    it('beliefChange が null の場合、createPersonaBelief を呼ばない', async () => {
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: 'クロージング。' } }),
      });
      // All turns return no beliefChange
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      expect(vi.mocked(repo.createPersonaBelief)).not.toHaveBeenCalled();
    });
  });

  describe('run — close シグナルと最低発言回数制約', () => {
    it('min-turns 未達のうちは close シグナルを無視して討論を継続する', async () => {
      // close every check, but min is 1 per persona (2 total)
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: 'クロージング。' } }),
      });
      const mockPersonaAgent = makeMockPersonaAgent();
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      // With 2 personas and minTurnsPerPersona=1:
      // - p1 speaks turn 1 → close check → p2 not spoken yet → NOT accepted
      // - p2 speaks turn 2 → close check → both spoken → ACCEPTED
      // So generateTurn should be called at least twice (once per persona)
      const personaTurnCalls = vi.mocked(repo.createDebateTurn).mock.calls.filter(
        c => c[0].speakerType === 'persona'
      );
      expect(personaTurnCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('全ペルソナが minTurnsPerPersona 回発言後に close シグナルを受け付け、generateClosing を呼ぶ', async () => {
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: 'クロージング。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      expect(mockFacilitator.generateClosing).toHaveBeenCalledOnce();
    });
  });

  describe('run — 討論後コメント', () => {
    it('全ペルソナ分の generatePostDebateComment を呼び、createPostDebateComment で保存する', async () => {
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: 'クロージング。' } }),
      });
      const mockPersonaAgent = makeMockPersonaAgent();
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      expect(mockPersonaAgent.generatePostDebateComment).toHaveBeenCalledTimes(testPersonaProfiles.length);
      expect(vi.mocked(repo.createPostDebateComment)).toHaveBeenCalledTimes(testPersonaProfiles.length);
    });
  });

  describe('run — セッション完了', () => {
    it('討論終了後に completeDebateSession を呼ぶ', async () => {
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: 'クロージング。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      expect(vi.mocked(repo.completeDebateSession)).toHaveBeenCalledWith('session-1', expect.any(Number));
    });
  });

  describe('task 3.1: DebateState 新フィールド', () => {
    it('resume はファシリテータートurnが複数ある場合でも最大 turnIndex を使って正常再開する', async () => {
      // facilitator turns at index 0 and 3 → lastFacilitatorTurnIndex should be 3
      vi.mocked(repo.getDebateTurnsBySessionId).mockResolvedValue([
        { id: 't0', sessionId: 'session-1', turnIndex: 0, speakerType: 'facilitator', content: '開会。', createdAt: '' },
        { id: 't1', sessionId: 'session-1', turnIndex: 1, speakerType: 'persona', personaId: 'p1', content: 'p1発言。', createdAt: '' },
        { id: 't2', sessionId: 'session-1', turnIndex: 2, speakerType: 'persona', personaId: 'p2', content: 'p2発言。', createdAt: '' },
        { id: 't3', sessionId: 'session-1', turnIndex: 3, speakerType: 'facilitator', content: '介入。', createdAt: '' },
      ]);

      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: 'クロージング。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      const result = await service.resume('session-1', 4);

      expect(result.ok).toBe(true);
    });

    it('resume はファシリテータートンがない場合も正常再開する（lastFacilitatorTurnIndex = 0）', async () => {
      // Only persona turns → lastFacilitatorTurnIndex defaults to 0
      vi.mocked(repo.getDebateTurnsBySessionId).mockResolvedValue([
        { id: 't1', sessionId: 'session-1', turnIndex: 0, speakerType: 'persona', personaId: 'p1', content: 'p1発言。', createdAt: '' },
        { id: 't2', sessionId: 'session-1', turnIndex: 1, speakerType: 'persona', personaId: 'p2', content: 'p2発言。', createdAt: '' },
      ]);

      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: 'クロージング。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      const result = await service.resume('session-1', 2);

      expect(result.ok).toBe(true);
    });

    // TypeScript: DebateState interface must have the new fields
    // This test verifies the exported type exists and can be referenced
    it('DebateState 型が export されており新フィールドを含む', () => {
      const state: DebateState = {
        history: [],
        currentBeliefs: new Map(),
        silenceMap: new Map(),
        speakCount: new Map(),
        lastAddressedPersonaId: undefined,
        lastAddressedByFacilitator: false,
        lastSpeakerId: undefined,
        pendingItems: new Map(),
        consecutiveDirectExchanges: 0,
        lastFacilitatorTurnIndex: 0,
        currentTurnIndex: 0,
      };
      expect(state.lastSpeakerId).toBeUndefined();
      expect(state.consecutiveDirectExchanges).toBe(0);
      expect(state.lastFacilitatorTurnIndex).toBe(0);
      expect(state.currentTurnIndex).toBe(0);
    });
  });

  describe('task 1.1: DEFAULT_CHAPTERS', () => {
    it('DEFAULT_CHAPTERS は 4 章を持つ', () => {
      expect(DEFAULT_CHAPTERS).toHaveLength(4);
    });

    it('DEFAULT_CHAPTERS の章タイトルが正しい', () => {
      expect(DEFAULT_CHAPTERS[0].title).toBe('導入');
      expect(DEFAULT_CHAPTERS[1].title).toBe('核心的対立');
      expect(DEFAULT_CHAPTERS[2].title).toBe('影響と懸念');
      expect(DEFAULT_CHAPTERS[3].title).toBe('まとめ');
    });

    it('DEFAULT_CHAPTERS の各章に focusQuestion が含まれる', () => {
      for (const chapter of DEFAULT_CHAPTERS) {
        expect(chapter.focusQuestion).toBeTruthy();
      }
    });

    it('DebateChapter 型が利用できる', () => {
      const chapter: DebateChapter = {
        index: 0,
        title: '導入',
        focusQuestion: 'この問題の核心は何か？',
        startTurnIndex: 1,
      };
      expect(chapter.index).toBe(0);
      expect(chapter.endTurnIndex).toBeUndefined();
    });
  });

  describe('task 3.5: DEFAULT_OPTIONS.maxTurns はセーフティネット用に 200', () => {
    it('DEFAULT_OPTIONS.maxTurns が 200 である', () => {
      expect(DEFAULT_OPTIONS.maxTurns).toBe(200);
    });

    it('close + 全ペルソナ minTurnsPerPersona 達成で maxTurns 未満で討論が終了する', async () => {
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      const result = await service.run('session-1', 't1');

      expect(result.ok).toBe(true);
      // Debate ended well before maxTurns=40 (shortOptions)
      const personaTurnCalls = vi.mocked(repo.createDebateTurn).mock.calls.filter(
        c => c[0].speakerType === 'persona'
      );
      expect(personaTurnCalls.length).toBeLessThan(shortOptions.maxTurns);
    });
  });

  describe('task 3.2: shouldEvaluateIntervention', () => {
    // shouldEvaluateIntervention(silenceMap, personasCount, turnsSinceFacilitator, interventionInterval)

    it('沈黙がインターバル以上かつ半インターバル以上経過 → true', () => {
      // maxSilence(8) >= interventionInterval(8) AND turnsSinceFacilitator(4) >= ceil(8/2)=4
      expect(shouldEvaluateIntervention(new Map([['p1', 8], ['p2', 1]]), 2, 4, 8)).toBe(true);
    });

    it('沈黙がインターバル以上でも直後（クールダウン中）は false', () => {
      // maxSilence(8) >= 8 but turnsSinceFacilitator(2) < ceil(8/2)=4 → false (prevents cascade)
      expect(shouldEvaluateIntervention(new Map([['p1', 8], ['p2', 1]]), 2, 2, 8)).toBe(false);
    });

    it('沈黙が personasCount を超えるだけでは発火しない（旧カスケード防止）', () => {
      expect(shouldEvaluateIntervention(new Map([['p1', 3], ['p2', 1]]), 2, 3, 8)).toBe(false);
    });

    it('最大間隔超過（turnsSinceFacilitator >= interventionInterval）→ true', () => {
      expect(shouldEvaluateIntervention(new Map(), 2, 10, 8)).toBe(true);
    });

    it('どの条件にも該当しない場合 → false', () => {
      expect(shouldEvaluateIntervention(new Map(), 2, 3, 8)).toBe(false);
    });
  });

  describe('task 3.4: executeDebate ループ制御ロジック改善', () => {
    it('直前の発言者を assessEngagement の対象から除外する', async () => {
      // Opening assigns firstPersonaId='p1' → p1 speaks turn 1
      // Turn 2: assessEngagement is called for p2 only (p1 excluded as lastSpeakerId)
      const mockPersonaAgent = makeMockPersonaAgent({
        generateTurn: vi.fn()
          .mockResolvedValueOnce({ ok: true, value: { content: 'p1発言。', beliefChange: null, addressedToPersonaId: undefined } })
          .mockResolvedValue({ ok: true, value: { content: 'p2発言。', beliefChange: null, addressedToPersonaId: undefined } }),
      });
      const mockFacilitator = makeMockFacilitator({
        generateOpening: vi.fn().mockResolvedValue({ ok: true, value: { content: '開会。', firstPersonaId: 'p1' } }),
        evaluateIntervention: vi.fn()
          .mockResolvedValueOnce({ ok: true, value: { shouldIntervene: false } })
          .mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      // assessEngagement should never be called for p1 right after p1 spoke
      const assessCalls = (mockPersonaAgent.assessEngagement as ReturnType<typeof vi.fn>).mock.calls;
      expect(assessCalls.length).toBeGreaterThanOrEqual(1);
      // First assessment call should not include p1 (they just spoke)
      expect(assessCalls[0][0].id).not.toBe('p1');
    });

    it('evaluateIntervention に state.speakCount (Map) を 3 番目の引数として渡す', async () => {
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      const interventionCalls = (mockFacilitator.evaluateIntervention as ReturnType<typeof vi.fn>).mock.calls;
      expect(interventionCalls.length).toBeGreaterThanOrEqual(1);
      // 3rd argument must be a Map (not undefined)
      expect(interventionCalls[0][2]).toBeInstanceOf(Map);
    });

    it('p1→p2 直接チェーン中は assessEngagement を呼ばず、チェーン後に呼ぶ', async () => {
      // Turn 1: p1 speaks (via opening's firstPersonaId) → addresses p2
      // Turn 2: p2 speaks via lastAddressedPersonaId → doesn't address anyone
      // Turn 3: assessEngagement called → close accepted → debate ends
      const mockPersonaAgent = makeMockPersonaAgent({
        generateTurn: vi.fn()
          .mockResolvedValueOnce({ ok: true, value: { content: 'p1→p2指名。', beliefChange: null, addressedToPersonaId: 'p2' } })
          .mockResolvedValue({ ok: true, value: { content: 'p2発言。', beliefChange: null, addressedToPersonaId: undefined } }),
      });
      const mockFacilitator = makeMockFacilitator({
        generateOpening: vi.fn().mockResolvedValue({ ok: true, value: { content: '開会。', firstPersonaId: 'p1' } }),
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      const generateTurnCalls = (mockPersonaAgent.generateTurn as ReturnType<typeof vi.fn>).mock.calls;
      // p1 and p2 both spoke via direct addressing chain
      expect(generateTurnCalls[0][0].id).toBe('p1');
      expect(generateTurnCalls[1][0].id).toBe('p2');
      // assessEngagement was NOT called during the chain (turns 1 and 2)
      // It IS called after chain breaks (turn 3 speaker selection)
      const assessCalls = (mockPersonaAgent.assessEngagement as ReturnType<typeof vi.fn>).mock.calls;
      expect(assessCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('task 3.3: evaluateParticipationBalance', () => {
    const p1 = testPersonaProfiles[0] as unknown as import('../types/index.js').PersonaAttributes;
    const p2 = testPersonaProfiles[1] as unknown as import('../types/index.js').PersonaAttributes;

    it('全員0回（討論開始直後）→ 全ペルソナを返す', () => {
      const speakCount = new Map([['p1', 0], ['p2', 0]]);
      const result = evaluateParticipationBalance(speakCount, [p1, p2]);
      expect(result.map(p => p.id)).toEqual(['p1', 'p2']);
    });

    it('全員均等に発言している場合 → 空配列を返す', () => {
      const speakCount = new Map([['p1', 4], ['p2', 4]]);
      const result = evaluateParticipationBalance(speakCount, [p1, p2]);
      expect(result).toHaveLength(0);
    });

    it('発言数に偏りがある場合 → 平均の50%以下のペルソナのみを返す', () => {
      // average = (8 + 2) / 2 = 5, threshold = 5 * 0.5 = 2.5 → p2(2) <= 2.5 → p2 が対象
      const speakCount = new Map([['p1', 8], ['p2', 2]]);
      const result = evaluateParticipationBalance(speakCount, [p1, p2]);
      expect(result.map(p => p.id)).toEqual(['p2']);
    });

    it('1ペルソナのみの場合 → 空配列を返す（自分自身は「偏り」にならない）', () => {
      // average = 3/1 = 3, threshold = 1.5 → p1(3) > 1.5 → 空
      const speakCount = new Map([['p1', 3]]);
      const result = evaluateParticipationBalance(speakCount, [p1]);
      expect(result).toHaveLength(0);
    });

    it('3ペルソナで1名だけ大幅に少ない → その1名のみを返す', () => {
      const p3 = { id: 'p3', stakeholderRole: '研究者', name: '山田次郎', age: 50, occupation: '大学教授', background: '', interests: '', stanceDirection: 'conditional' };
      // average = (6 + 6 + 1) / 3 ≈ 4.33, threshold ≈ 2.17 → p3(1) <= 2.17
      const speakCount = new Map([['p1', 6], ['p2', 6], ['p3', 1]]);
      const result = evaluateParticipationBalance(
        speakCount,
        [p1, p2, p3] as import('../types/index.js').PersonaAttributes[]
      );
      expect(result.map(p => p.id)).toEqual(['p3']);
    });
  });

  describe('task 5.1: 章の生成・保存フロー', () => {
    it('run 冒頭で saveChapters を呼ぶ', async () => {
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      expect(vi.mocked(repo.saveChapters)).toHaveBeenCalledOnce();
    });

    it('generateChapters 失敗時は DEFAULT_CHAPTERS でフォールバックして saveChapters を呼ぶ', async () => {
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
        generateChapters: vi.fn().mockResolvedValue({ ok: false, error: { code: 'AI_API_ERROR', message: 'fail', retryable: true } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      expect(vi.mocked(repo.saveChapters)).toHaveBeenCalledWith(
        't1',
        expect.arrayContaining([expect.objectContaining({ title: '導入', index: 0 })])
      );
    });

    it('generateOpening に第 1 章コンテキスト（index: 0）が渡される', async () => {
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      expect(mockFacilitator.generateOpening).toHaveBeenCalledWith(
        'AI医療診断の導入',
        expect.any(Array),
        expect.objectContaining({ index: 0, title: '導入' })
      );
    });
  });

  describe('task 5.2: executeChapter と 2 層ループ', () => {
    it('各ペルソナターンに chapterIndex が付与される', async () => {
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      const personaTurns = vi.mocked(repo.createDebateTurn).mock.calls.filter(
        c => c[0].speakerType === 'persona'
      );
      expect(personaTurns.length).toBeGreaterThanOrEqual(1);
      for (const [params] of personaTurns) {
        expect(params.chapterIndex).toBeGreaterThanOrEqual(0);
      }
    });

    it('目標ターン数到達で章が進行しクロージングまで到達する', async () => {
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: false } }),
      });
      // turnsPerChapter=2 → maxChapterTurns=ceil(2*1.5)=3
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), { ...shortOptions, maxTurns: 8, turnsPerChapter: 2 });

      await service.run('session-1', 't1');

      expect(mockFacilitator.generateClosing).toHaveBeenCalledOnce();
    });

    it('evaluateIntervention が close を返しても executeChapter ループを中断しない', async () => {
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), { ...shortOptions, maxTurns: 8, turnsPerChapter: 2 });

      await service.run('session-1', 't1');

      expect(mockFacilitator.generateClosing).toHaveBeenCalledOnce();
    });

    it('updateCurrentChapterIndex が章ごとに呼ばれる', async () => {
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), { ...shortOptions, maxTurns: 8, turnsPerChapter: 2 });

      await service.run('session-1', 't1');

      expect(vi.mocked(repo.updateCurrentChapterIndex)).toHaveBeenCalledWith('t1', 0);
    });

    it('task 7.2: 150% 到達後に強制遷移する', async () => {
      const generateChapterSummary = vi.fn().mockResolvedValue({ ok: true, value: '強制遷移まとめ。' });
      const generateChapterIntroduction = vi.fn().mockResolvedValue({ ok: true, value: '強制遷移導入。' });
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: false } }),
        generateChapterSummary,
        generateChapterIntroduction,
      });
      // turnsPerChapter=2 → maxChapterTurns=ceil(2*1.5)=3
      const service = new DebateOrchestratorService(
        mockFacilitator, makeMockPersonaAgent(), makeMockTracker(),
        { ...shortOptions, maxTurns: 8, turnsPerChapter: 2 }
      );

      await service.run('session-1', 't1');

      expect(generateChapterSummary).toHaveBeenCalled();
      expect(mockFacilitator.generateClosing).toHaveBeenCalledOnce();
    });
  });

  describe('task 5.3: resume の章対応', () => {
    it('chapters がある場合、currentChapterIndex の章から再開し新ターンに chapterIndex >= startChapterIndex が付く', async () => {
      vi.mocked(repo.getDebateSessionById).mockResolvedValue({
        id: 'session-1',
        topicId: 't1',
        status: 'running',
        createdAt: '',
        chapters: [
          { index: 0, title: '導入', focusQuestion: '問題の核心は？' },
          { index: 1, title: '核心的対立', focusQuestion: '意見が分かれる点は？' },
        ],
        currentChapterIndex: 1,
      });
      vi.mocked(repo.getDebateTurnsBySessionId).mockResolvedValue([
        { id: 't0', sessionId: 'session-1', turnIndex: 0, speakerType: 'facilitator', content: '討論を始めます。', createdAt: '', chapterIndex: undefined },
        { id: 't1', sessionId: 'session-1', turnIndex: 1, speakerType: 'persona', personaId: 'p1', content: 'p1発言。', createdAt: '', chapterIndex: 0 },
        { id: 't2', sessionId: 'session-1', turnIndex: 2, speakerType: 'persona', personaId: 'p2', content: 'p2発言。', createdAt: '', chapterIndex: 1 },
      ]);

      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      const result = await service.resume('session-1', 3);

      expect(result.ok).toBe(true);
      const newPersonaTurns = vi.mocked(repo.createDebateTurn).mock.calls.filter(
        c => c[0].speakerType === 'persona'
      );
      expect(newPersonaTurns.length).toBeGreaterThanOrEqual(1);
      for (const [params] of newPersonaTurns) {
        expect(params.chapterIndex).toBeGreaterThanOrEqual(1);
      }
    });

    it('chapters がない旧セッションでは既存動作にフォールバックして result.ok が true になる', async () => {
      vi.mocked(repo.getDebateSessionById).mockResolvedValue({
        id: 'session-1',
        topicId: 't1',
        status: 'running',
        createdAt: '',
      });

      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      const result = await service.resume('session-1', 2);

      expect(result.ok).toBe(true);
      expect(vi.mocked(repo.completeDebateSession)).toHaveBeenCalledOnce();
    });
  });

  describe('resume — 指定ターンから再開', () => {
    it('fromTurnIndex=2 で再開すると turnIndex >= 2 のターンのみ新規作成する', async () => {
      // 2 existing turns in DB (index 0, 1)
      vi.mocked(repo.getDebateTurnsBySessionId).mockResolvedValue([
        { id: 't0', sessionId: 'session-1', turnIndex: 0, speakerType: 'facilitator', content: '討論を始めます。', createdAt: '' },
        { id: 't1', sessionId: 'session-1', turnIndex: 1, speakerType: 'persona', personaId: 'p1', content: 'p1の発言。', createdAt: '' },
      ]);

      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: 'クロージング。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      await service.resume('session-1', 2);

      // No opening should be generated (fromTurnIndex > 0)
      expect(mockFacilitator.generateOpening).not.toHaveBeenCalled();

      // New turns should start at turnIndex >= 2
      const newPersonaTurns = vi.mocked(repo.createDebateTurn).mock.calls.filter(
        c => c[0].speakerType === 'persona'
      );
      for (const [params] of newPersonaTurns) {
        expect(params.turnIndex).toBeGreaterThanOrEqual(2);
      }
    });

    it('resume は getDebateSessionById でセッションを取得し topicId を特定する', async () => {
      vi.mocked(repo.getDebateSessionById).mockResolvedValue({ id: 'session-1', topicId: 't1', status: 'running', createdAt: '' });
      vi.mocked(repo.getDebateTurnsBySessionId).mockResolvedValue([
        { id: 't0', sessionId: 'session-1', turnIndex: 0, speakerType: 'facilitator', content: '開会。', createdAt: '' },
        { id: 't1', sessionId: 'session-1', turnIndex: 1, speakerType: 'persona', personaId: 'p1', content: 'p1発言。', createdAt: '' },
        { id: 't2', sessionId: 'session-1', turnIndex: 2, speakerType: 'persona', personaId: 'p2', content: 'p2発言。', createdAt: '' },
      ]);

      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: 'クロージング。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      const result = await service.resume('session-1', 3);

      expect(result.ok).toBe(true);
      expect(vi.mocked(repo.getDebateSessionById)).toHaveBeenCalledWith('session-1');
    });
  });

  describe('task 4.3: saveEngagements が各ターンで呼ばれる', () => {
    it('assessEngagement の後に saveEngagements を呼び出す', async () => {
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      expect(vi.mocked(repo.saveEngagements)).toHaveBeenCalled();
    });
  });

  describe('task 4.4: generateTurn に intentSummary が渡される', () => {
    it('assessEngagement の intentSummary が generateTurn の 8 番目引数として渡される', async () => {
      const mockPersonaAgent = makeMockPersonaAgent({
        assessEngagement: vi.fn().mockResolvedValue({
          ok: true, value: { score: 3, mode: 'full', intentSummary: 'テスト意図' },
        }),
      });
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      const generateTurnCalls = (mockPersonaAgent.generateTurn as ReturnType<typeof vi.fn>).mock.calls;
      // Opening assigns p1 first → after p1 speaks, only p2 is assessed (intentSummary='テスト意図')
      // p2 is then selected → generateTurn for p2 should have intentSummary as 8th arg (index 7)
      expect(generateTurnCalls.length).toBeGreaterThanOrEqual(2);
      const p2Call = generateTurnCalls.find((c: unknown[]) => (c[0] as { id: string }).id === 'p2');
      expect(p2Call?.[7]).toBe('テスト意図');
    });
  });

  describe('task 4.5: resume に loadPendingIntents が追加', () => {
    it('resume() が loadPendingIntents() を呼び出す', async () => {
      vi.mocked(repo.getDebateTurnsBySessionId).mockResolvedValue([
        { id: 't0', sessionId: 'session-1', turnIndex: 0, speakerType: 'facilitator', content: '開会。', createdAt: '' },
        { id: 't1', sessionId: 'session-1', turnIndex: 1, speakerType: 'persona', personaId: 'p1', content: 'p1発言。', createdAt: '' },
      ]);
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      await service.resume('session-1', 2);

      expect(vi.mocked(repo.loadPendingIntents)).toHaveBeenCalledWith('session-1');
    });
  });

  describe('task 6.3: エンゲージメント駆動ロジックの追加テスト', () => {
    const p3 = {
      id: 'p3', topicId: 't1', stakeholderRole: '研究者', name: '山田次郎',
      age: 50, occupation: '大学教授', background: '経済学専攻', interests: '社会保障',
      stanceDirection: 'conditional', approved: true, sortOrder: 2,
    };

    describe('pendingItems: score >= 5 かつ未選択のみ addToPending: true', () => {
      it('p3(score=5/reaction) が urgentReaction で選ばれると p2(score=5/full) が addToPending:true で saveEngagements に渡される', async () => {
        vi.mocked(repo.getPersonasByTopicId).mockResolvedValue([...testPersonaProfiles, p3]);

        const mockPersonaAgent = makeMockPersonaAgent({
          assessEngagement: vi.fn().mockImplementation(async (persona: { id: string }) => {
            if (persona.id === 'p2') return { ok: true, value: { score: 5, mode: 'full' as const, intentSummary: '言いたいこと' } };
            if (persona.id === 'p3') return { ok: true, value: { score: 5, mode: 'reaction' as const, intentSummary: undefined } };
            return { ok: true, value: { score: 2, mode: 'reaction' as const, intentSummary: undefined } };
          }),
        });
        const mockFacilitator = makeMockFacilitator({
          evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
        });
        const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, makeMockTracker(), { ...shortOptions, maxTurns: 4 });

        await service.run('session-1', 't1');

        const calls = vi.mocked(repo.saveEngagements).mock.calls;
        expect(calls.length).toBeGreaterThanOrEqual(1);
        const firstCall = calls[0][0];
        const p2Entry = firstCall.assessments.find((a: { personaId: string }) => a.personaId === 'p2');
        const p3Entry = firstCall.assessments.find((a: { personaId: string }) => a.personaId === 'p3');
        expect(p2Entry?.addToPending).toBe(true);  // p2 scored 5 but was not selected (p3 took urgentReaction priority)
        expect(p3Entry?.addToPending).toBe(false); // p3 scored 5 and was selected via urgentReaction
      });
    });

    describe('generateTurn: assessedMode が index 6 引数として渡される', () => {
      it('assessEngagement の mode 値が generateTurn の 7 番目引数（index 6）として渡される', async () => {
        const mockPersonaAgent = makeMockPersonaAgent({
          assessEngagement: vi.fn().mockImplementation(async (persona: { id: string }) => ({
            ok: true,
            value: { score: 3, mode: persona.id === 'p1' ? ('full' as const) : ('reaction' as const), intentSummary: undefined },
          })),
        });
        const mockFacilitator = makeMockFacilitator({
          evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
        });
        const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, makeMockTracker(), shortOptions);

        await service.run('session-1', 't1');

        const generateTurnCalls = (mockPersonaAgent.generateTurn as ReturnType<typeof vi.fn>).mock.calls;
        const p2Call = generateTurnCalls.find((c: unknown[]) => (c[0] as { id: string }).id === 'p2');
        expect(p2Call).toBeDefined();
        expect(p2Call?.[6]).toBe('reaction'); // assessedMode at index 6
      });
    });

    describe('topScore <= 3 かつキューあり: キュー参照選択', () => {
      it('score >= 5 でキューに入った p2 が次の全員 score <= 3 ターンで選ばれる', async () => {
        vi.mocked(repo.getPersonasByTopicId).mockResolvedValue([...testPersonaProfiles, p3]);

        // Round 1 (after p1 speaks): p2=score5/full → queue, p3=score5/reaction → urgentReaction で selected
        // Round 2 (after p3 speaks): all=score2 → topScore<=3, queue has p2 → p2 selected
        let callCount = 0;
        const mockPersonaAgent = makeMockPersonaAgent({
          assessEngagement: vi.fn().mockImplementation(async (persona: { id: string }) => {
            callCount++;
            if (callCount <= 2) {
              if (persona.id === 'p2') return { ok: true, value: { score: 5, mode: 'full' as const, intentSummary: '言いたいこと' } };
              if (persona.id === 'p3') return { ok: true, value: { score: 5, mode: 'reaction' as const, intentSummary: undefined } };
            }
            return { ok: true, value: { score: 2, mode: 'reaction' as const, intentSummary: undefined } };
          }),
        });

        const service = new DebateOrchestratorService(
          makeMockFacilitator(), mockPersonaAgent, makeMockTracker(),
          { ...shortOptions, maxTurns: 4 },
        );

        await service.run('session-1', 't1');

        const generateTurnCalls = (mockPersonaAgent.generateTurn as ReturnType<typeof vi.fn>).mock.calls;
        // Turn 1: p1 (via opening), Turn 2: p3 (score=5 highest), Turn 3: p2 (from queue, topScore=2)
        expect(generateTurnCalls).toHaveLength(3);
        expect((generateTurnCalls[0][0] as { id: string }).id).toBe('p1');
        expect((generateTurnCalls[1][0] as { id: string }).id).toBe('p3');
        expect((generateTurnCalls[2][0] as { id: string }).id).toBe('p2');
      });
    });

    describe('chapter end detection: score >= 5 → recentScores に 1', () => {
      it('全員 score < 5 が続くと early exit で章移行が増え、score >= 5 があると増えない', async () => {
        const lowFacilitator = makeMockFacilitator();
        const lowAgent = makeMockPersonaAgent({
          assessEngagement: vi.fn().mockResolvedValue({
            ok: true, value: { score: 2, mode: 'reaction' as const, intentSummary: undefined },
          }),
        });
        const lowService = new DebateOrchestratorService(lowFacilitator, lowAgent, makeMockTracker(), { ...shortOptions, maxTurns: 12 });
        await lowService.run('session-1', 't1');
        const lowSummaryCalls = (lowFacilitator.generateChapterSummary as ReturnType<typeof vi.fn>).mock.calls.length;

        const highFacilitator = makeMockFacilitator();
        const highAgent = makeMockPersonaAgent({
          assessEngagement: vi.fn().mockResolvedValue({
            ok: true, value: { score: 5, mode: 'full' as const, intentSummary: undefined },
          }),
        });
        const highService = new DebateOrchestratorService(highFacilitator, highAgent, makeMockTracker(), { ...shortOptions, maxTurns: 12 });
        await highService.run('session-1', 't1');
        const highSummaryCalls = (highFacilitator.generateChapterSummary as ReturnType<typeof vi.fn>).mock.calls.length;

        // Low scores: early exit → faster chapter rotation → more summary calls within same maxTurns
        expect(lowSummaryCalls).toBeGreaterThan(highSummaryCalls);
      });
    });
  });
});
