import type { DebateTurn, PersonaProfile } from '../types/repository.types.js';

export function formatPersonas(personas: PersonaProfile[]): string {
  return personas
    .map((p) => `- ID: ${p.id}, 名前: ${p.name}, 立場: ${p.specificRole || p.stakeholderRole}`)
    .join('\n');
}

export function formatHistory(history: DebateTurn[]): string {
  return history
    .map(t => {
      const name = t.speakerName ?? (t.personaId ? `Persona(${t.personaId})` : 'ファシリテーター');
      const role = t.speakerRole ?? '';
      return t.personaId
        ? `[${name}(${role})(ID:${t.personaId})]: ${t.content}`
        : `[${name}(${role})]: ${t.content}`;
    })
    .join('\n');
}
