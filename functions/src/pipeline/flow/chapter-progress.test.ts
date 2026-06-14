import { describe, it, expect } from 'vitest';
import { toEngagementSignal, shouldEndChapterEarly, chapterTurnCap } from './chapter-progress.js';

describe('toEngagementSignal', () => {
  it('full かつ score>=4 のペルソナがいれば活性（1）', () => {
    expect(toEngagementSignal([
      { score: 4, mode: 'opinion' },
      { score: 1, mode: 'none' },
    ])).toBe(1);
  });

  it('score 5 はモードに関わらず活性（1）', () => {
    expect(toEngagementSignal([{ score: 5, mode: 'reaction' }])).toBe(1);
  });

  it('reaction score 4 は新論点を出さないため非活性（0）', () => {
    expect(toEngagementSignal([{ score: 4, mode: 'reaction' }])).toBe(0);
  });

  it('full でも score 3 以下なら非活性（0）', () => {
    expect(toEngagementSignal([
      { score: 3, mode: 'opinion' },
      { score: 2, mode: 'reaction' },
    ])).toBe(0);
  });

  it('評価スキップターン（評価なし）は常に活性（1）', () => {
    expect(toEngagementSignal([])).toBe(1);
  });
});

describe('shouldEndChapterEarly', () => {
  const fiveInactive: Array<0 | 1> = [0, 0, 0, 0, 0];

  it('75%消化かつ直近5シグナルすべて非活性なら true', () => {
    expect(shouldEndChapterEarly({
      chapterTurnCount: 12,
      targetTurns: 16, // 75% = 12
      engagementSignals: fiveInactive,
    })).toBe(true);
  });

  it('75% 未満なら false（境界: ceil(15*0.75)=12 に対し 11）', () => {
    expect(shouldEndChapterEarly({
      chapterTurnCount: 11,
      targetTurns: 15,
      engagementSignals: fiveInactive,
    })).toBe(false);
  });

  it('75% 境界ちょうど（ceil(15*0.75)=12）で true', () => {
    expect(shouldEndChapterEarly({
      chapterTurnCount: 12,
      targetTurns: 15,
      engagementSignals: fiveInactive,
    })).toBe(true);
  });

  it('シグナルが5件未満なら必ず false', () => {
    expect(shouldEndChapterEarly({
      chapterTurnCount: 20,
      targetTurns: 15,
      engagementSignals: [0, 0, 0, 0],
    })).toBe(false);
  });

  it('直近5件に活性が1つでもあれば false', () => {
    expect(shouldEndChapterEarly({
      chapterTurnCount: 12,
      targetTurns: 15,
      engagementSignals: [0, 0, 1, 0, 0],
    })).toBe(false);
  });

  it('直近5件より前の活性は判定に影響しない', () => {
    expect(shouldEndChapterEarly({
      chapterTurnCount: 12,
      targetTurns: 15,
      engagementSignals: [1, 1, 0, 0, 0, 0, 0],
    })).toBe(true);
  });
});

describe('chapterTurnCap', () => {
  it('上限は目標の150%（切り上げ）', () => {
    expect(chapterTurnCap(15)).toBe(23); // ceil(22.5)
    expect(chapterTurnCap(10)).toBe(15);
    expect(chapterTurnCap(2)).toBe(3);
  });
});
