import type { ConversationTurn } from '../types/index.js';

export function formatHistory(history: ConversationTurn[]): string {
  return history
    .map(t => t.personaId
      ? `[${t.speakerName}(${t.speakerRole})(ID:${t.personaId})]: ${t.content}`
      : `[${t.speakerName}(${t.speakerRole})]: ${t.content}`
    )
    .join('\n');
}
