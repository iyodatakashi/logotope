import type { DebateTurn } from '../types/repository.types.js';

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
