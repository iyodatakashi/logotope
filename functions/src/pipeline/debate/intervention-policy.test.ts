import { describe, it, expect } from 'vitest';
import { shouldEvaluateIntervention } from './intervention-policy.js';

describe('shouldEvaluateIntervention', () => {
  it('クールダウン経過で true（毎ターン評価が原則）', () => {
    expect(shouldEvaluateIntervention(2, 2)).toBe(true);
  });

  it('クールダウン未満（ペルソナ発言1 < 2）はスキップ（false）', () => {
    expect(shouldEvaluateIntervention(1, 2)).toBe(false);
  });

  it('クールダウン超過（3 >= 2）で true', () => {
    expect(shouldEvaluateIntervention(3, 2)).toBe(true);
  });

  it('ファシリテーター発言直後（0ターン）は false', () => {
    expect(shouldEvaluateIntervention(0, 2)).toBe(false);
  });
});
