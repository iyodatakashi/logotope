import type { ConversationTurn } from '../types/index.js';

export function formatHistory(history: ConversationTurn[]): string {
  return history
    .map(t => `[${t.speakerName}(${t.speakerRole})]: ${t.content}`)
    .join('\n');
}
