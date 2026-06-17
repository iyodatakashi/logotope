import { describe, it, expect } from 'vitest';
import {
  resolvePairConversation,
  selectNextSpeaker,
  shouldQueue,
  shouldSpeak,
} from './speaker-selection.js';
import { QUEUE_THRESHOLD_SCORE, SPEAK_THRESHOLD_SCORE } from '../../constants/flow.constants.js';
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

describe('shouldQueue / shouldSpeak', () => {
  it('QUEUE_THRESHOLD_SCORE 以上はキューに積むべき', () => {
    expect(shouldQueue({ score: QUEUE_THRESHOLD_SCORE })).toBe(true);
    expect(shouldQueue({ score: QUEUE_THRESHOLD_SCORE + 1 })).toBe(true);
  });

  it('QUEUE_THRESHOLD_SCORE 未満はキューに積まない（境界）', () => {
    expect(shouldQueue({ score: QUEUE_THRESHOLD_SCORE - 1 })).toBe(false);
  });

  it('shouldSpeak は1人でも SPEAK_THRESHOLD_SCORE 以上がいれば true', () => {
    expect(shouldSpeak([
      { score: 2 },
      { score: SPEAK_THRESHOLD_SCORE },
    ])).toBe(true);
  });

  it('shouldSpeak は全員が SPEAK_THRESHOLD_SCORE 未満なら false', () => {
    expect(shouldSpeak([
      { score: 1 },
      { score: SPEAK_THRESHOLD_SCORE - 1 },
    ])).toBe(false);
  });

  it('shouldSpeak は空集合で false', () => {
    expect(shouldSpeak([])).toBe(false);
  });
});

