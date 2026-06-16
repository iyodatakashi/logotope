import type { OrchestratorOptions } from '../types/debate-orchestrator.types';
import {
	TURNS_PER_CHAPTER,
	MAX_TURNS,
	DEFAULT_INTERVENTION_COOLDOWN
} from '../constants/flow.constants';

export const DEFAULT_OPTIONS: OrchestratorOptions = {
	turnsPerChapter: TURNS_PER_CHAPTER,
	maxTurns: MAX_TURNS,
	interventionCooldown: DEFAULT_INTERVENTION_COOLDOWN
};
