export interface InterventionPolicyInput {
  speakerPredetermined: boolean;
  personaTurnsSinceFacilitator: number;
  cooldownTurns: number;
}

/** 次話者未確定かつクールダウン経過で true（毎ターン評価が原則） */
export const shouldEvaluateIntervention = (input: InterventionPolicyInput): boolean => {
  if (input.speakerPredetermined) return false;
  return input.personaTurnsSinceFacilitator >= input.cooldownTurns;
};
