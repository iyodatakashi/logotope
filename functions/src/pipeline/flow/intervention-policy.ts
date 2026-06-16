import type { InterventionPolicyInput } from '../../types/flow.types.js';

/** クールダウン経過で true（論点ずれ介入(A)専用。B は高意欲者なしを gate とし、クールダウン不問） */
export const shouldEvaluateIntervention = (input: InterventionPolicyInput): boolean => {
  return input.personaTurnsSinceFacilitator >= input.cooldownTurns;
};
