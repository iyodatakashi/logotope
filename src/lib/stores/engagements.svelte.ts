import { onSnapshot, collection } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { EngagementHistoryEntry } from '$lib/models/engagement/engagement.types';

export type EngagementHistoryEntryWithPersona = EngagementHistoryEntry & { turnId: string; personaId: string };

export const buildEngagementsMap = (
  rawDocs: Array<{ personaId: string; history: Record<string, EngagementHistoryEntry> }>
): Map<string, EngagementHistoryEntryWithPersona[]> => {
  const result = new Map<string, EngagementHistoryEntryWithPersona[]>();
  for (const { personaId, history } of rawDocs) {
    for (const [turnId, entry] of Object.entries(history)) {
      const list = result.get(turnId) ?? [];
      result.set(turnId, [...list, { ...entry, turnId, personaId }]);
    }
  }
  return result;
};

export const createEngagementsStore = (topicId: string) => {
  let engagementsMap = $state<Map<string, EngagementHistoryEntryWithPersona[]>>(new Map());
  let unsubscribe: (() => void) | null = null;

  const setChapterId = (chapterId: string | null) => {
    unsubscribe?.();
    unsubscribe = null;
    if (chapterId === null) {
      engagementsMap = new Map();
      return;
    }
    const ref = collection(db, 'topics', topicId, 'chapters', chapterId, 'engagements');
    unsubscribe = onSnapshot(ref, (snap) => {
      const docs = snap.docs.map((d) => ({
        personaId: d.id,
        history: (d.data().history ?? {}) as Record<string, EngagementHistoryEntry>,
      }));
      engagementsMap = buildEngagementsMap(docs);
    });
  };

  const start = () => {
    // 購読は setChapterId 経由で管理する（currentTopic.svelte.ts の $effect から呼ばれる）
  };

  const stop = () => {
    setChapterId(null);
  };

  return {
    get engagementsMap() {
      return engagementsMap;
    },
    setChapterId,
    start,
    stop,
  };
};
