import type { PipelineError } from '../../types/common.types.js';
import type { Persona } from '../../types/persona.types.js';

export const pipelineErrorMessage = (e: PipelineError): string => {
	if ('message' in e) return e.message;
	if ('resource' in e) return `${e.code}: ${e.resource}`;
	return `${e.code}: expected=${e.expected} current=${e.current}`;
};

/** ID が参加ペルソナに存在する場合のみ返す（LLM 由来の不正 ID を無視する） */
export const validPersonaId = (
	personaId: string | undefined,
	personas: ReadonlyArray<Persona>
): string | undefined => {
	return personaId && personas.some((p) => p.id === personaId) ? personaId : undefined;
};
