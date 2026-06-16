import { describe, it, expect } from 'vitest';
import {
  resolvePairConversation,
  decideNextSpeaker,
  isHighEngagement,
  hasHighEngagement,
} from './speaker-selection.js';
import { HIGH_ENGAGEMENT_SCORE } from '../../constants/flow.constants.js';
import type { PendingIntent } from '../../types/debate.types.js';

const personaIds = ['p1', 'p2', 'p3'];

describe('resolvePairConversation', () => {
  it('ファシリテーター指名は連続ペア対話の上限に関わらず確定する', () => {
    expect(resolvePairConversation({ personaId: 'p2', targetedBy: 'facilitator' }, 3, personaIds))
      .toEqual({ personaId: 'p2', reason: 'targeted_by_facilitator' });
  });

  it('ペルソナ間の指名は上限未満なら確定する', () => {
    expect(resolvePairConversation({ personaId: 'p3', targetedBy: 'persona' }, 2, personaIds))
      .toEqual({ personaId: 'p3', reason: 'targeted_by_persona' });
  });

  it('ペルソナ間の指名が3回連続したら中断する（null）', () => {
    expect(resolvePairConversation({ personaId: 'p3', targetedBy: 'persona' }, 3, personaIds))
      .toBeNull();
  });

  it('指名先IDが参加ペルソナに存在しない場合は無視する（null）', () => {
    expect(resolvePairConversation({ personaId: 'unknown', targetedBy: 'facilitator' }, 0, personaIds))
      .toBeNull();
  });

  it('指名・直接質問がない場合は null を返す', () => {
    expect(resolvePairConversation(undefined, 0, personaIds)).toBeNull();
  });
});

describe('isHighEngagement / hasHighEngagement', () => {
  it('HIGH_ENGAGEMENT_SCORE 以上のスコアを高意欲とみなす', () => {
    expect(isHighEngagement({ score: HIGH_ENGAGEMENT_SCORE })).toBe(true);
    expect(isHighEngagement({ score: HIGH_ENGAGEMENT_SCORE + 1 })).toBe(true);
  });

  it('HIGH_ENGAGEMENT_SCORE 未満は高意欲でない（境界）', () => {
    expect(isHighEngagement({ score: HIGH_ENGAGEMENT_SCORE - 1 })).toBe(false);
  });

  it('hasHighEngagement は1人でも高意欲がいれば true', () => {
    expect(hasHighEngagement([
      { score: 2 },
      { score: HIGH_ENGAGEMENT_SCORE },
    ])).toBe(true);
  });

  it('hasHighEngagement は全員が境界未満なら false', () => {
    expect(hasHighEngagement([
      { score: 1 },
      { score: HIGH_ENGAGEMENT_SCORE - 1 },
    ])).toBe(false);
  });

  it('hasHighEngagement は空集合で false', () => {
    expect(hasHighEngagement([])).toBe(false);
  });
});

type DecideInput = {
  assessments?: Array<{ personaId: string; score: number; mode: 'opinion' | 'fact' | 'none'; intentSummary?: string }>;
  pendingIntents?: Map<string, PendingIntent[]>;
  silenceMap?: Map<string, number>;
  lastSpeakerId?: string;
};

describe('decideNextSpeaker', () => {
  const call = (overrides: DecideInput = {}) => decideNextSpeaker(
    overrides.assessments ?? [
      { personaId: 'p2', score: 3, mode: 'opinion' },
      { personaId: 'p3', score: 2, mode: 'opinion' },
    ],
    overrides.pendingIntents ?? new Map<string, PendingIntent[]>(),
    overrides.silenceMap ?? new Map([['p1', 0], ['p2', 1], ['p3', 2]]),
    personaIds,
    overrides.lastSpeakerId ?? 'p1',
  );

  describe('優先順位 (1): 意図キュー（高意欲者なし）', () => {
    it('全員の score が3以下のとき、キューの最古エントリ保持者を選ぶ', () => {
      const pendingIntents = new Map<string, PendingIntent[]>([
        ['p2', [{ triggerTurnIndex: 5, intentSummary: 'p2の意図' }]],
        ['p3', [{ triggerTurnIndex: 2, intentSummary: 'p3の意図' }]],
      ]);
      const decision = call({ pendingIntents });
      expect(decision.personaId).toBe('p3'); // triggerTurnIndex 2 が最古
      expect(decision.reason).toBe('queue');
      expect(decision.intentSummary).toBe('p3の意図');
    });

    it('score 4以上のペルソナがいる場合はキューより評価ベースを優先する', () => {
      const pendingIntents = new Map<string, PendingIntent[]>([
        ['p3', [{ triggerTurnIndex: 2, intentSummary: 'p3の意図' }]],
      ]);
      const decision = call({
        assessments: [
          { personaId: 'p2', score: 4, mode: 'opinion' },
          { personaId: 'p3', score: 2, mode: 'none' },
        ],
        pendingIntents,
      });
      expect(decision.personaId).toBe('p2');
      expect(decision.reason).toBe('score');
    });

    it('直前話者のキューは選択対象外', () => {
      const pendingIntents = new Map<string, PendingIntent[]>([
        ['p1', [{ triggerTurnIndex: 1, intentSummary: 'p1の意図' }]],
        ['p2', [{ triggerTurnIndex: 4, intentSummary: 'p2の意図' }]],
      ]);
      const decision = call({ pendingIntents });
      expect(decision.personaId).toBe('p2');
      expect(decision.reason).toBe('queue');
    });
  });

  describe('優先順位 (2): スコア選択', () => {
    it('score 降順で選択する', () => {
      const decision = call({
        assessments: [
          { personaId: 'p2', score: 4, mode: 'opinion', intentSummary: '意見がある' },
          { personaId: 'p3', score: 2, mode: 'opinion' },
        ],
      });
      expect(decision).toEqual({ personaId: 'p2', reason: 'score' });
    });

    it('同点時は沈黙ターン数の長い方を優先する', () => {
      const decision = call({
        assessments: [
          { personaId: 'p2', score: 3, mode: 'opinion' },
          { personaId: 'p3', score: 3, mode: 'opinion' },
        ],
        silenceMap: new Map([['p2', 1], ['p3', 4]]),
      });
      expect(decision.personaId).toBe('p3');
    });

    it('候補が1人しかいなければ score 1（none）でもその人を選ぶ', () => {
      const decision = call({
        assessments: [{ personaId: 'p2', score: 1, mode: 'none' }],
      });
      expect(decision.personaId).toBe('p2');
      expect(decision.reason).toBe('score');
    });

    it('直前話者は連続して選択しない（他に候補がいる場合）', () => {
      const decision = call({
        assessments: [
          { personaId: 'p1', score: 4, mode: 'opinion' },
          { personaId: 'p2', score: 4, mode: 'opinion' },
        ],
        lastSpeakerId: 'p1',
        silenceMap: new Map([['p1', 0], ['p2', 0]]),
      });
      expect(decision.personaId).toBe('p2');
    });

    it('直前話者が唯一の最高スコア保持者の場合は連続発言を許容する', () => {
      const decision = call({
        assessments: [
          { personaId: 'p1', score: 5, mode: 'opinion' },
          { personaId: 'p2', score: 3, mode: 'opinion' },
        ],
        lastSpeakerId: 'p1',
      });
      expect(decision.personaId).toBe('p1');
    });
  });

  describe('境界ケース', () => {
    it('評価が空の場合も personaIds から直前話者以外を選ぶ', () => {
      const decision = call({
        assessments: [],
        lastSpeakerId: 'p1',
      });
      expect(decision.personaId).not.toBe('p1');
      expect(personaIds).toContain(decision.personaId);
    });

    it('戻り値の personaId は必ず personaIds に含まれる', () => {
      const decision = call({
        assessments: [
          { personaId: 'ghost', score: 5, mode: 'opinion' },
          { personaId: 'p2', score: 2, mode: 'opinion' },
        ],
      });
      expect(personaIds).toContain(decision.personaId);
    });
  });
});

