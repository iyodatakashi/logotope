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

export const formatTurns = (turns: DebateTurn[]): string => {
	return turns
		.map((t) => {
			const name = t.speakerName ?? (t.personaId ? `Persona(${t.personaId})` : 'ファシリテーター');
			const role = t.speakerRole ?? '';
			return t.personaId
				? `[${name}(${role})(ID:${t.personaId})]: ${t.content}`
				: `[${name}(${role})]: ${t.content}`;
		})
		.join('\n');
};
