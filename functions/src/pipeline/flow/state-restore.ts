import type { DebateTurn } from '../../db/repository.js';
import type { PersonaAttributes, PendingIntent } from '../../types/index.js';

const INTENT_EXPIRY_TURNS = 8;

export interface DebateState {
  history: DebateTurn[];
  currentBeliefs: Map<string, { content: string; version: number }>;
  silenceMap: Map<string, number>;
  speakCount: Map<string, number>;
  pendingAddress?: { personaId: string; byFacilitator: boolean };
  lastSpeakerId?: string;
  pendingIntents: Map<string, PendingIntent[]>;
  consecutiveDirectExchanges: number;
  lastFacilitatorTurnIndex: number;
  currentTurnIndex: number;
  engagementSignals: Array<0 | 1>;
}

export interface RestoreInput {
  turns: ReadonlyArray<DebateTurn>;
  personas: ReadonlyArray<PersonaAttributes>;
  persistedPendingIntents: ReadonlyMap<string, ReadonlyArray<PendingIntent>>;
  currentBeliefs: Map<string, { content: string; version: number }>;
}

/** 保存済みターン・永続化キューから DebateState を一意に復元する（同一入力 → 同一出力） */
export const restoreDebateState = (input: RestoreInput): DebateState => {
  const { personas, persistedPendingIntents, currentBeliefs } = input;
  const turns = [...input.turns].sort((a, b) => a.turnIndex - b.turnIndex);

  const currentTurnIndex = turns.length > 0 ? turns[turns.length - 1].turnIndex + 1 : 0;

  const speakCount = new Map<string, number>(personas.map(p => [p.id, 0]));
  for (const t of turns) {
    if (t.personaId && t.speakerType === 'persona') {
      speakCount.set(t.personaId, (speakCount.get(t.personaId) ?? 0) + 1);
    }
  }

  const silenceMap = new Map<string, number>();
  for (const p of personas) {
    const lastSpokeIdx = turns
      .filter(t => t.personaId === p.id && t.speakerType === 'persona')
      .reduce((max, t) => Math.max(max, t.turnIndex), -1);
    silenceMap.set(p.id, Math.max(0, currentTurnIndex - lastSpokeIdx - 1));
  }

  const lastFacilitatorTurnIndex = turns
    .filter(t => t.speakerType === 'facilitator')
    .reduce((max, t) => Math.max(max, t.turnIndex), 0);

  let lastSpeakerId: string | undefined;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].speakerType === 'persona' && turns[i].personaId) {
      lastSpeakerId = turns[i].personaId ?? undefined;
      break;
    }
  }

  const pendingIntents = new Map<string, PendingIntent[]>();
  for (const [personaId, items] of persistedPendingIntents.entries()) {
    const alive = items.filter(
      item => currentTurnIndex - item.triggerTurnIndex <= INTENT_EXPIRY_TURNS
    );
    if (alive.length > 0) {
      pendingIntents.set(personaId, alive.map(item => ({ ...item })));
    }
  }

  // 直近指名の復元: 最後のターンに永続化された addressedPersonaId から復元する
  // （ファシリテーターの指名 / ペルソナの直接質問。不正 ID は無視する）
  let pendingAddress: DebateState['pendingAddress'];
  const lastTurn = turns[turns.length - 1];
  if (lastTurn?.addressedPersonaId && personas.some(p => p.id === lastTurn.addressedPersonaId)) {
    pendingAddress = {
      personaId: lastTurn.addressedPersonaId,
      byFacilitator: lastTurn.speakerType === 'facilitator',
    };
  }

  return {
    history: turns,
    currentBeliefs: new Map(currentBeliefs),
    silenceMap,
    speakCount,
    pendingAddress,
    lastSpeakerId,
    pendingIntents,
    consecutiveDirectExchanges: 0,
    lastFacilitatorTurnIndex,
    currentTurnIndex,
    engagementSignals: [],
  };
};
