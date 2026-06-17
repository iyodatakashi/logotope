import { describe, it, expect } from 'vitest';
import { checkChapterContinuation, hasReachedEarlyEnd, chapterTurnCap } from './chapter-progress.js';
import { CONTINUE_CHAPTER_THRESHOLD, CHAPTER_END_COUNT_LIMIT } from '../../constants/flow.constants.js';

describe('checkChapterContinuation', () => {
  it('CONTINUE_CHAPTER_THRESHOLD 以上のペルソナがいれば true', () => {
    expect(checkChapterContinuation([
      { score: CONTINUE_CHAPTER_THRESHOLD },
      { score: 1 },
    ])).toBe(true);
  });

  it('全員が CONTINUE_CHAPTER_THRESHOLD 未満なら false', () => {
    expect(checkChapterContinuation([
      { score: CONTINUE_CHAPTER_THRESHOLD - 1 },
      { score: 1 },
    ])).toBe(false);
  });

  it('評価スキップターン（評価なし）は常に true', () => {
    expect(checkChapterContinuation([])).toBe(true);
  });
});

describe('hasReachedEarlyEnd', () => {
  it('75%消化かつ chapterEndCount が CHAPTER_END_COUNT_LIMIT 以上なら true', () => {
    expect(hasReachedEarlyEnd(12, 15, CHAPTER_END_COUNT_LIMIT)).toBe(true); // ceil(15*0.75)=12
  });

  it('75% 未満なら false（境界: ceil(15*0.75)=12 に対し 11）', () => {
    expect(hasReachedEarlyEnd(11, 15, CHAPTER_END_COUNT_LIMIT)).toBe(false);
  });

  it('75% 境界ちょうど（ceil(15*0.75)=12）で true', () => {
    expect(hasReachedEarlyEnd(12, 15, CHAPTER_END_COUNT_LIMIT)).toBe(true);
  });

  it('chapterEndCount が CHAPTER_END_COUNT_LIMIT 未満なら false', () => {
    expect(hasReachedEarlyEnd(20, 15, CHAPTER_END_COUNT_LIMIT - 1)).toBe(false);
  });
});

describe('chapterTurnCap', () => {
  it('上限は目標の150%（切り上げ）', () => {
    expect(chapterTurnCap(15)).toBe(23); // ceil(22.5)
    expect(chapterTurnCap(10)).toBe(15);
    expect(chapterTurnCap(2)).toBe(3);
  });
});
