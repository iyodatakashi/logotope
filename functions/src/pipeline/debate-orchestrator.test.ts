import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldEvaluateIntervention, evaluateParticipationBalance, DEFAULT_OPTIONS } from './debate-orchestrator.js';

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
    debugLog: vi.fn().mockResolvedValue(undefined),
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
        lastSpeakerId: undefined,
        consecutiveDirectExchanges: 0,
        lastFacilitatorTurnIndex: 0,
      };
      expect(state.lastSpeakerId).toBeUndefined();
      expect(state.consecutiveDirectExchanges).toBe(0);
      expect(state.lastFacilitatorTurnIndex).toBe(0);
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

    it('緊急沈黙（silenceMap 最大値 > personasCount）→ true', () => {
      expect(shouldEvaluateIntervention(new Map([['p1', 3], ['p2', 1]]), 2, 3, 8)).toBe(true);
    });

    it('最大間隔超過（turnsSinceFacilitator >= interventionInterval）→ true', () => {
      expect(shouldEvaluateIntervention(new Map(), 2, 10, 8)).toBe(true);
    });

    it('どの条件にも該当しない場合 → false', () => {
      expect(shouldEvaluateIntervention(new Map(), 2, 3, 8)).toBe(false);
    });
  });

  describe('task 3.4: executeDebate ループ制御ロジック改善', () => {
    it('selectNextSpeaker に直前の発言者 ID (lastSpeakerId) を excludePersonaId として渡す', async () => {
      // Opening assigns firstPersonaId='p1' → p1 speaks turn 1 via lastAddressedPersonaId
      // Turn 2: lastAddressedPersonaId is undefined → selectNextSpeaker called with excludePersonaId='p1'
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
        selectNextSpeaker: vi.fn().mockResolvedValue({ ok: true, value: 'p2' }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      // selectNextSpeaker should be called with 'p1' as 4th arg (excludePersonaId)
      const speakerCalls = (mockFacilitator.selectNextSpeaker as ReturnType<typeof vi.fn>).mock.calls;
      expect(speakerCalls.length).toBeGreaterThanOrEqual(1);
      expect(speakerCalls[0][3]).toBe('p1');
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

    it('p1→p2 直接チェーン中は selectNextSpeaker を呼ばず、チェーン後に 1 回だけ呼ぶ', async () => {
      // Turn 1: p1 speaks (via opening's firstPersonaId) → addresses p2
      // Turn 2: p2 speaks via lastAddressedPersonaId → doesn't address anyone
      // Turn 3: selectNextSpeaker called → close accepted → debate ends
      const mockPersonaAgent = makeMockPersonaAgent({
        generateTurn: vi.fn()
          .mockResolvedValueOnce({ ok: true, value: { content: 'p1→p2指名。', beliefChange: null, addressedToPersonaId: 'p2' } })
          .mockResolvedValue({ ok: true, value: { content: 'p2発言。', beliefChange: null, addressedToPersonaId: undefined } }),
      });
      const mockFacilitator = makeMockFacilitator({
        generateOpening: vi.fn().mockResolvedValue({ ok: true, value: { content: '開会。', firstPersonaId: 'p1' } }),
        evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: true, type: 'close', content: '終了。' } }),
        selectNextSpeaker: vi.fn().mockResolvedValue({ ok: true, value: 'p1' }),
      });
      const service = new DebateOrchestratorService(mockFacilitator, mockPersonaAgent, makeMockTracker(), shortOptions);

      await service.run('session-1', 't1');

      const generateTurnCalls = (mockPersonaAgent.generateTurn as ReturnType<typeof vi.fn>).mock.calls;
      // p1 and p2 both spoke (turns 1 and 2) via direct addressing chain
      expect(generateTurnCalls[0][0].id).toBe('p1');
      expect(generateTurnCalls[1][0].id).toBe('p2');
      // selectNextSpeaker was NOT called during the chain (turns 1 and 2)
      // It IS called once after chain breaks (turn 3 speaker selection), then close accepted
      const selectCalls = (mockFacilitator.selectNextSpeaker as ReturnType<typeof vi.fn>).mock.calls;
      expect(selectCalls.length).toBe(1); // only called after chain breaks
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
