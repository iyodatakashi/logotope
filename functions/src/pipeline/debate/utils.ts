import type { PipelineError } from '../../types/common.types.js';
import type { Persona } from '../../types/persona.types.js';
import { EARLY_END_PROGRESS_RATIO, QUIET_STREAK_LIMIT } from '../../constants/debate.constants.js';

/**
 * 章が早期終了の候補か（進捗が一定割合に達し、かつ盛り上がりが連続して低い）を判定する純関数。
 * 次ステップ判定（decideNextStep）と早期終了前のカバレッジ再確認（reconcileEarlyEndCoverage）で
 * 同一式を使うため一本化する。
 */
export const isEarlyEndCandidate = (
	chapterTurnCount: number,
	turnsPerChapter: number,
	quietStreak: number
): boolean =>
	chapterTurnCount >= Math.ceil(turnsPerChapter * EARLY_END_PROGRESS_RATIO) &&
	quietStreak >= QUIET_STREAK_LIMIT;

export const pipelineErrorMessage = (error: PipelineError): string => {
	if ('message' in error) return error.message;
	if ('resource' in error) return `${error.code}: ${error.resource}`;
	return `${error.code}: expected=${error.expected} current=${error.current}`;
};

/** ID が参加ペルソナに存在する場合のみ返す（LLM 由来の不正 ID を無視する） */
export const validPersonaId = (
	personaId: string | undefined,
	personas: ReadonlyArray<Persona>
): string | undefined => {
	return personaId && personas.some((persona) => persona.id === personaId) ? personaId : undefined;
};
