import { describe, it, expect } from 'vitest';
import { resolveDirectAddress, decideNextSpeaker } from './speaker-selection.js';
import type { SpeakerSelectionInput } from './speaker-selection.js';
import type { PendingIntent } from '../../types/index.js';

const personaIds = ['p1', 'p2', 'p3'];

describe('resolveDirectAddress', () => {
  it('ファシリテーター指名は連続直接交換の上限に関わらず確定する（mode full）', () => {
    const decision = resolveDirectAddress({
      pendingAddress: { personaId: 'p2', byFacilitator: true },
      consecutiveDirectExchanges: 3,
      personaIds,
    });
    expect(decision).toEqual({ personaId: 'p2', source: 'nomination', mode: 'full' });
  });

  it('ペルソナ間の直接質問は上限未満なら確定する', () => {
    const decision = resolveDirectAddress({
      pendingAddress: { personaId: 'p3', byFacilitator: false },
      consecutiveDirectExchanges: 2,
      personaIds,
    });
    expect(decision).toEqual({ personaId: 'p3', source: 'direct_address' });
  });

  it('ペルソナ間の直接質問が3回連続したら中断する（null）', () => {
    const decision = resolveDirectAddress({
      pendingAddress: { personaId: 'p3', byFacilitator: false },
      consecutiveDirectExchanges: 3,
      personaIds,
    });
    expect(decision).toBeNull();
  });

  it('指名先IDが参加ペルソナに存在しない場合は無視する（null）', () => {
    const decision = resolveDirectAddress({
      pendingAddress: { personaId: 'unknown', byFacilitator: true },
      consecutiveDirectExchanges: 0,
      personaIds,
    });
    expect(decision).toBeNull();
  });

  it('指名・直接質問がない場合は null を返す', () => {
    const decision = resolveDirectAddress({
      pendingAddress: undefined,
      consecutiveDirectExchanges: 0,
      personaIds,
    });
    expect(decision).toBeNull();
  });
});

describe('decideNextSpeaker', () => {
  const baseInput = (overrides: Partial<SpeakerSelectionInput> = {}): SpeakerSelectionInput => ({
    assessments: [
      { personaId: 'p2', score: 3, mode: 'full' },
      { personaId: 'p3', score: 2, mode: 'reaction' },
    ],
    pendingIntents: new Map<string, PendingIntent[]>(),
    silenceMap: new Map([['p1', 0], ['p2', 1], ['p3', 2]]),
    lastSpeakerId: 'p1',
    personaIds,
    ...overrides,
  });

  describe('優先順位 (1): invite 指名', () => {
    it('invite 指名は緊急リアクションより優先される（mode full 固定）', () => {
      const decision = decideNextSpeaker(baseInput({
        assessments: [
          { personaId: 'p2', score: 5, mode: 'reaction' },
          { personaId: 'p3', score: 2, mode: 'full' },
        ],
        interventionTargetId: 'p3',
      }));
      expect(decision.personaId).toBe('p3');
      expect(decision.source).toBe('nomination');
      expect(decision.mode).toBe('full');
    });

    it('invite 指名のIDが不正な場合は無視してスコア選択にフォールバックする', () => {
      const decision = decideNextSpeaker(baseInput({
        interventionTargetId: 'unknown',
      }));
      expect(decision.personaId).toBe('p2'); // score 3 が最高
      expect(decision.source).toBe('score');
    });
  });

  describe('優先順位 (3): 緊急リアクション', () => {
    it('mode=reaction かつ score>=4 のペルソナが即時選択される', () => {
      const decision = decideNextSpeaker(baseInput({
        assessments: [
          { personaId: 'p2', score: 4, mode: 'reaction' },
          { personaId: 'p3', score: 5, mode: 'full', intentSummary: '反論したい' },
        ],
      }));
      expect(decision.personaId).toBe('p2');
      expect(decision.source).toBe('urgent_reaction');
      expect(decision.mode).toBe('reaction');
    });

    it('緊急リアクションが複数いる場合はスコア降順・同点は沈黙の長い方を優先する', () => {
      const decision = decideNextSpeaker(baseInput({
        assessments: [
          { personaId: 'p2', score: 4, mode: 'reaction' },
          { personaId: 'p3', score: 4, mode: 'reaction' },
        ],
        silenceMap: new Map([['p2', 1], ['p3', 5]]),
      }));
      expect(decision.personaId).toBe('p3');
    });

    it('直前話者は緊急リアクションの対象外（他の緊急リアクションが優先される）', () => {
      const decision = decideNextSpeaker(baseInput({
        assessments: [
          { personaId: 'p1', score: 5, mode: 'reaction' },
          { personaId: 'p2', score: 4, mode: 'reaction' },
          { personaId: 'p3', score: 3, mode: 'full' },
        ],
        lastSpeakerId: 'p1',
      }));
      expect(decision.personaId).toBe('p2');
      expect(decision.source).toBe('urgent_reaction');
    });
  });

  describe('優先順位 (4): 意図キュー（全員 score <= 3）', () => {
    it('全員の score が3以下のとき、キューの最古エントリ保持者を full モードで選ぶ', () => {
      const pendingIntents = new Map<string, PendingIntent[]>([
        ['p2', [{ triggerTurnIndex: 5, intentSummary: 'p2の意図' }]],
        ['p3', [{ triggerTurnIndex: 2, intentSummary: 'p3の意図' }]],
      ]);
      const decision = decideNextSpeaker(baseInput({ pendingIntents }));
      expect(decision.personaId).toBe('p3'); // triggerTurnIndex 2 が最古
      expect(decision.source).toBe('queue');
      expect(decision.mode).toBe('full');
      expect(decision.intentSummary).toBe('p3の意図');
    });

    it('score 4以上のペルソナがいる場合はキューより評価ベースを優先する', () => {
      const pendingIntents = new Map<string, PendingIntent[]>([
        ['p3', [{ triggerTurnIndex: 2, intentSummary: 'p3の意図' }]],
      ]);
      const decision = decideNextSpeaker(baseInput({
        assessments: [
          { personaId: 'p2', score: 4, mode: 'full' },
          { personaId: 'p3', score: 2, mode: 'none' },
        ],
        pendingIntents,
      }));
      expect(decision.personaId).toBe('p2');
      expect(decision.source).toBe('score');
    });

    it('直前話者のキューは選択対象外', () => {
      const pendingIntents = new Map<string, PendingIntent[]>([
        ['p1', [{ triggerTurnIndex: 1, intentSummary: 'p1の意図' }]],
        ['p2', [{ triggerTurnIndex: 4, intentSummary: 'p2の意図' }]],
      ]);
      const decision = decideNextSpeaker(baseInput({ pendingIntents }));
      expect(decision.personaId).toBe('p2');
      expect(decision.source).toBe('queue');
    });
  });

  describe('優先順位 (5): スコア選択', () => {
    it('score 降順で選択し、申告モードと intentSummary を引き継ぐ', () => {
      const decision = decideNextSpeaker(baseInput({
        assessments: [
          { personaId: 'p2', score: 4, mode: 'full', intentSummary: '意見がある' },
          { personaId: 'p3', score: 2, mode: 'reaction' },
        ],
      }));
      expect(decision).toEqual({
        personaId: 'p2',
        source: 'score',
        mode: 'full',
        intentSummary: '意見がある',
      });
    });

    it('同点時は沈黙ターン数の長い方を優先する', () => {
      const decision = decideNextSpeaker(baseInput({
        assessments: [
          { personaId: 'p2', score: 3, mode: 'full' },
          { personaId: 'p3', score: 3, mode: 'full' },
        ],
        silenceMap: new Map([['p2', 1], ['p3', 4]]),
      }));
      expect(decision.personaId).toBe('p3');
    });

    it('mode が none の場合 mode は undefined になる', () => {
      const decision = decideNextSpeaker(baseInput({
        assessments: [{ personaId: 'p2', score: 1, mode: 'none' }],
      }));
      expect(decision.personaId).toBe('p2');
      expect(decision.mode).toBeUndefined();
    });

    it('直前話者は連続して選択しない（他に候補がいる場合）', () => {
      const decision = decideNextSpeaker(baseInput({
        assessments: [
          { personaId: 'p1', score: 4, mode: 'full' },
          { personaId: 'p2', score: 4, mode: 'full' },
        ],
        lastSpeakerId: 'p1',
        silenceMap: new Map([['p1', 0], ['p2', 0]]),
      }));
      expect(decision.personaId).toBe('p2');
    });

    it('直前話者が唯一の最高スコア保持者の場合は連続発言を許容する', () => {
      const decision = decideNextSpeaker(baseInput({
        assessments: [
          { personaId: 'p1', score: 5, mode: 'full' },
          { personaId: 'p2', score: 3, mode: 'full' },
        ],
        lastSpeakerId: 'p1',
      }));
      expect(decision.personaId).toBe('p1');
    });
  });

  describe('境界ケース', () => {
    it('評価が空の場合も personaIds から直前話者以外を選ぶ', () => {
      const decision = decideNextSpeaker(baseInput({
        assessments: [],
        lastSpeakerId: 'p1',
      }));
      expect(decision.personaId).not.toBe('p1');
      expect(personaIds).toContain(decision.personaId);
    });

    it('戻り値の personaId は必ず personaIds に含まれる', () => {
      const decision = decideNextSpeaker(baseInput({
        assessments: [
          { personaId: 'ghost', score: 5, mode: 'full' },
          { personaId: 'p2', score: 2, mode: 'full' },
        ],
      }));
      expect(personaIds).toContain(decision.personaId);
    });
  });
});
