export interface InterventionPolicyInput {
  personaTurnsSinceFacilitator: number;
  cooldownTurns: number;
}

/** クールダウン経過で true（論点戻し・出尽くしの両介入に共通のレート制限） */
export const shouldEvaluateIntervention = (input: InterventionPolicyInput): boolean => {
  return input.personaTurnsSinceFacilitator >= input.cooldownTurns;
};
