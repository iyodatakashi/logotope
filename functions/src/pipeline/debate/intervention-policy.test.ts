import { describe, it, expect } from 'vitest';
import { shouldEvaluateIntervention } from './intervention-policy.js';

describe('shouldEvaluateIntervention', () => {
  it('クールダウン経過で true（毎ターン評価が原則）', () => {
    expect(shouldEvaluateIntervention({
      personaTurnsSinceFacilitator: 2,
      cooldownTurns: 2,
    })).toBe(true);
  });

  it('クールダウン未満（ペルソナ発言1 < 2）はスキップ（false）', () => {
    expect(shouldEvaluateIntervention({
      personaTurnsSinceFacilitator: 1,
      cooldownTurns: 2,
    })).toBe(false);
  });

  it('クールダウン超過（3 >= 2）で true', () => {
    expect(shouldEvaluateIntervention({
      personaTurnsSinceFacilitator: 3,
      cooldownTurns: 2,
    })).toBe(true);
  });

  it('ファシリテーター発言直後（0ターン）は false', () => {
    expect(shouldEvaluateIntervention({
      personaTurnsSinceFacilitator: 0,
      cooldownTurns: 2,
    })).toBe(false);
  });
});
