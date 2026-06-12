import { describe, it, expect } from 'vitest';
import { shouldEvaluateIntervention } from './intervention-policy.js';

describe('shouldEvaluateIntervention', () => {
  it('次話者未確定かつクールダウン経過で true（毎ターン評価が原則）', () => {
    expect(shouldEvaluateIntervention({
      speakerPredetermined: false,
      personaTurnsSinceFacilitator: 2,
      cooldownTurns: 2,
    })).toBe(true);
  });

  it('次話者が指名・直接質問で確定済みならスキップ（false）', () => {
    expect(shouldEvaluateIntervention({
      speakerPredetermined: true,
      personaTurnsSinceFacilitator: 10,
      cooldownTurns: 2,
    })).toBe(false);
  });

  it('クールダウン未満（ペルソナ発言1 < 2）はスキップ（false）', () => {
    expect(shouldEvaluateIntervention({
      speakerPredetermined: false,
      personaTurnsSinceFacilitator: 1,
      cooldownTurns: 2,
    })).toBe(false);
  });

  it('クールダウン超過（3 >= 2）で true', () => {
    expect(shouldEvaluateIntervention({
      speakerPredetermined: false,
      personaTurnsSinceFacilitator: 3,
      cooldownTurns: 2,
    })).toBe(true);
  });

  it('ファシリテーター発言直後（0ターン）は false', () => {
    expect(shouldEvaluateIntervention({
      speakerPredetermined: false,
      personaTurnsSinceFacilitator: 0,
      cooldownTurns: 2,
    })).toBe(false);
  });
});
