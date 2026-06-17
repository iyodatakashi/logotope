import { describe, it, expect } from 'vitest';
import {
  selectSpeaker,
  shouldQueue,
  shouldSpeak,
} from './speaker-selection.js';
import { QUEUE_THRESHOLD_SCORE, SPEAK_THRESHOLD_SCORE } from '../../constants/flow.constants.js';
import type { PendingIntent } from '../../types/debate.types.js';

const personaIds = ['p1', 'p2', 'p3'];

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

