import { onSnapshot, collection } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { EngagementHistoryEntry } from '$lib/models/engagement/engagement.types';

export type EngagementHistoryEntryWithPersona = EngagementHistoryEntry & { turnIndex: number; personaId: string };

export const buildEngagementsMap = (
  rawDocs: Array<{ personaId: string; history: Record<string, EngagementHistoryEntry> }>
): Map<number, EngagementHistoryEntryWithPersona[]> => {
  const result = new Map<number, EngagementHistoryEntryWithPersona[]>();
  for (const { personaId, history } of rawDocs) {
    for (const [key, entry] of Object.entries(history)) {
      const turnIndex = parseInt(key, 10);
      const list = result.get(turnIndex) ?? [];
      result.set(turnIndex, [...list, { ...entry, turnIndex, personaId }]);
    }
  }
  return result;
};

export const createEngagementsStore = (topicId: string) => {
  let engagementsMap = $state<Map<number, EngagementHistoryEntryWithPersona[]>>(new Map());
  let unsubscribe: (() => void) | null = null;

  const start = () => {
    const ref = collection(db, 'topics', topicId, 'engagements');
    unsubscribe = onSnapshot(ref, (snap) => {
      const docs = snap.docs.map((d) => ({
        personaId: d.id,
        history: (d.data().history ?? {}) as Record<string, EngagementHistoryEntry>,
      }));
      engagementsMap = buildEngagementsMap(docs);
    });
  };

  const stop = () => {
    unsubscribe?.();
    unsubscribe = null;
  };

  return {
    get engagementsMap() {
      return engagementsMap;
    },
    start,
    stop,
  };
};
