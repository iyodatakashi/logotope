import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/repository.js', () => ({
  getTopicById: vi.fn(),
  getApprovedPersonasByTopicId: vi.fn(),
  getPersonaBeliefsByPersonaId: vi.fn(),
  getPersonaInterviewByPersonaId: vi.fn(),
  getDebateTurnsBySessionId: vi.fn(),
  getDebateSessionById: vi.fn(),
  createDebateTurn: vi.fn(),
  createPersonaBelief: vi.fn(),
  createPostDebateComment: vi.fn(),
  completeDebateSession: vi.fn(),
  updateTopicStatus: vi.fn(),
}));
vi.mock('firebase-admin/data-connect', () => ({ getDataConnect: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));

import * as repo from '../db/repository.js';
import { DebateOrchestratorService } from './debate-orchestrator.js';
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
    selectNextSpeaker: vi.fn().mockResolvedValue({ ok: true, value: 'p2' }),
    evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: false } }),
    generateClosing: vi.fn().mockResolvedValue({ ok: true, value: 'お疲れ様でした。' }),
    ...overrides,
  } as unknown as FacilitatorAgentService;
}

function makeMockPersonaAgent(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    generateTurn: vi.fn().mockResolvedValue({ ok: true, value: { content: '私の意見です。', beliefChange: null, addressedToPersonaId: undefined } }),
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
  } as unknown as ProgressTrackerService;
}

function setupRepoDefaults() {
  vi.mocked(repo.getTopicById).mockResolvedValue({ id: 't1', title: 'AI医療診断の導入', status: 'debating', createdAt: '', updatedAt: '' });
  vi.mocked(repo.getApprovedPersonasByTopicId).mockResolvedValue(testPersonaProfiles);
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
}

// Short debate options for tests: check intervention every turn, accept 1 speak per persona
const shortOptions = { maxTurns: 40, interventionInterval: 1, silenceThreshold: 100, minTurnsPerPersona: 1 };

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

      expect(mockFacilitator.generateOpening).toHaveBeenCalledWith('AI医療診断の導入', expect.any(Array));
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
        selectNextSpeaker: vi.fn().mockResolvedValue({ ok: true, value: 'p1' }), // if called, returns p1 (not p2)
      });
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      // The second generateTurn call should be for p2 (direct addressing from p1's turn)
      // NOT for p1 (which is what selectNextSpeaker would return as fallback)
      const generateTurnCalls = (mockPersonaAgent.generateTurn as ReturnType<typeof vi.fn>).mock.calls;
      expect(generateTurnCalls.length).toBeGreaterThanOrEqual(2);
      expect((generateTurnCalls[1][0] as { id: string }).id).toBe('p2');
    });

    it('addressedToPersonaId なし: selectNextSpeaker を呼んで次話者を決定する', async () => {
      // Turns return no addressedToPersonaId → selectNextSpeaker is called
      const mockFacilitator = makeMockFacilitator({
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: 'クロージング。' } }),
        selectNextSpeaker: vi.fn().mockResolvedValue({ ok: true, value: 'p2' }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, makeMockPersonaAgent(), makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      // After p1's turn (no addressedTo), selectNextSpeaker is called for turn 2
      expect(mockFacilitator.selectNextSpeaker).toHaveBeenCalled();
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
});
