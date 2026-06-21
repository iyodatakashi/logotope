import type { DebateTurn } from '../types/debate.types.js';
import type { Persona } from '../types/persona.types.js';

export const currentDateString = (): string => {
	const d = new Date();
	return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

export const formatPersonas = (personas: Persona[]): string => {
	return personas
		.map((p) => `- ID: ${p.id}, 名前: ${p.name}, 立場: ${p.specificRole || p.stakeholderRole}`)
		.join('\n');
};

export const formatTurns = (
	turns: ReadonlyArray<DebateTurn>,
	personas: ReadonlyArray<Persona>
): string => {
	return turns
		.map((t) => {
			if (t.personaId) {
				const persona = personas.find((p) => p.id === t.personaId);
				const name = persona ? persona.name : `Persona(${t.personaId})`;
				const role = persona ? persona.specificRole || persona.stakeholderRole : '';
				return `[${name}(${role})(ID:${t.personaId})]: ${t.content}`;
			}
			return `[ファシリテーター()]: ${t.content}`;
		})
		.join('\n');
};
