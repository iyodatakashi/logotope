import { describe, it, expect } from 'vitest';
import {
  resolveDirectAddress,
  decideNextSpeaker,
  speechFromAssessment,
  isHighEngagement,
  hasHighEngagement,
} from './speaker-selection.js';
import { HIGH_ENGAGEMENT_SCORE } from '../../constants/flow.constants.js';
import type { SpeakerSelectionInput } from '../../types/flow.types.js';
import type { PendingIntent } from '../../types/index.js';

const personaIds = ['p1', 'p2', 'p3'];

describe('resolveDirectAddress', () => {
  it('ファシリテーター指名は連続直接交換の上限に関わらず確定する（mode 指定なし）', () => {
    const decision = resolveDirectAddress({
      pendingAddress: { personaId: 'p2', byFacilitator: true },
      consecutiveDirectExchanges: 3,
      personaIds,
    });
    expect(decision).toEqual({ personaId: 'p2', source: 'nomination' });
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

describe('decideNextSpeaker', () => {
  const baseInput = (overrides: Partial<SpeakerSelectionInput> = {}): SpeakerSelectionInput => ({
    assessments: [
      { personaId: 'p2', score: 3, mode: 'opinion' },
      { personaId: 'p3', score: 2, mode: 'opinion' },
    ],
    pendingIntents: new Map<string, PendingIntent[]>(),
    silenceMap: new Map([['p1', 0], ['p2', 1], ['p3', 2]]),
    lastSpeakerId: 'p1',
    personaIds,
    ...overrides,
  });

  describe('優先順位 (1): 意図キュー（高意欲者なし）', () => {
    it('全員の score が3以下のとき、キューの最古エントリ保持者を選ぶ', () => {
      const pendingIntents = new Map<string, PendingIntent[]>([
        ['p2', [{ triggerTurnIndex: 5, intentSummary: 'p2の意図' }]],
        ['p3', [{ triggerTurnIndex: 2, intentSummary: 'p3の意図' }]],
      ]);
      const decision = decideNextSpeaker(baseInput({ pendingIntents }));
      expect(decision.personaId).toBe('p3'); // triggerTurnIndex 2 が最古
      expect(decision.source).toBe('queue');
      expect(decision.intentSummary).toBe('p3の意図');
    });

    it('score 4以上のペルソナがいる場合はキューより評価ベースを優先する', () => {
      const pendingIntents = new Map<string, PendingIntent[]>([
        ['p3', [{ triggerTurnIndex: 2, intentSummary: 'p3の意図' }]],
      ]);
      const decision = decideNextSpeaker(baseInput({
        assessments: [
          { personaId: 'p2', score: 4, mode: 'opinion' },
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

  describe('優先順位 (2): スコア選択', () => {
    it('score 降順で選択する', () => {
      const decision = decideNextSpeaker(baseInput({
        assessments: [
          { personaId: 'p2', score: 4, mode: 'opinion', intentSummary: '意見がある' },
          { personaId: 'p3', score: 2, mode: 'opinion' },
        ],
      }));
      expect(decision).toEqual({ personaId: 'p2', source: 'score' });
    });

    it('同点時は沈黙ターン数の長い方を優先する', () => {
      const decision = decideNextSpeaker(baseInput({
        assessments: [
          { personaId: 'p2', score: 3, mode: 'opinion' },
          { personaId: 'p3', score: 3, mode: 'opinion' },
        ],
        silenceMap: new Map([['p2', 1], ['p3', 4]]),
      }));
      expect(decision.personaId).toBe('p3');
    });

    it('候補が1人しかいなければ score 1（none）でもその人を選ぶ', () => {
      const decision = decideNextSpeaker(baseInput({
        assessments: [{ personaId: 'p2', score: 1, mode: 'none' }],
      }));
      expect(decision.personaId).toBe('p2');
      expect(decision.source).toBe('score');
    });

    it('直前話者は連続して選択しない（他に候補がいる場合）', () => {
      const decision = decideNextSpeaker(baseInput({
        assessments: [
          { personaId: 'p1', score: 4, mode: 'opinion' },
          { personaId: 'p2', score: 4, mode: 'opinion' },
        ],
        lastSpeakerId: 'p1',
        silenceMap: new Map([['p1', 0], ['p2', 0]]),
      }));
      expect(decision.personaId).toBe('p2');
    });

    it('直前話者が唯一の最高スコア保持者の場合は連続発言を許容する', () => {
      const decision = decideNextSpeaker(baseInput({
        assessments: [
          { personaId: 'p1', score: 5, mode: 'opinion' },
          { personaId: 'p2', score: 3, mode: 'opinion' },
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
          { personaId: 'ghost', score: 5, mode: 'opinion' },
          { personaId: 'p2', score: 2, mode: 'opinion' },
        ],
      }));
      expect(personaIds).toContain(decision.personaId);
    });
  });
});

describe('speechFromAssessment', () => {
  it('評価が無ければ空（生成側の既定に委ねる）', () => {
    expect(speechFromAssessment(undefined)).toEqual({});
  });

  it('opinion/fact はその mode と score をそのまま使う', () => {
    expect(speechFromAssessment({ mode: 'fact', score: 3 })).toEqual({ mode: 'fact', score: 3 });
  });

  it('none・score1 は最小発言（opinion・score 2）に切り上げる', () => {
    expect(speechFromAssessment({ mode: 'none', score: 1 })).toEqual({ mode: 'opinion', score: 2 });
  });

  it('score が 2 未満なら 2 に切り上げる', () => {
    expect(speechFromAssessment({ mode: 'opinion', score: 1 })).toEqual({ mode: 'opinion', score: 2 });
  });
});
