import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { DebateTopic, DebateSession } from '../types/debate.types.js';
import type { Persona } from '../types/persona.types.js';

const db = () => getFirestore();

export const getTopicById = async (id: string): Promise<DebateTopic | null> => {
  const snap = await db().doc(`topics/${id}`).get();
  if (!snap.exists) return null;
  const data = snap.data() as { title: string; createdAt: Timestamp; updatedAt: Timestamp };
  return {
    id: snap.id,
    title: data.title,
    createdAt: data.createdAt?.toDate().toISOString() ?? '',
    updatedAt: data.updatedAt?.toDate().toISOString() ?? '',
  };
};

export const getPersonasByTopicId = async (topicId: string): Promise<Persona[]> => {
  const snap = await db().collection(`topics/${topicId}/personas`).orderBy('sortOrder', 'asc').get();
  return snap.docs.map((docSnap) => {
    const data = docSnap.data() as Omit<Persona, 'specificRole'> & { specificRole?: string };
    return { ...data, id: docSnap.id, specificRole: data.specificRole ?? data.stakeholderRole };
  });
};

export const getDebateSessionByTopicId = async (topicId: string): Promise<DebateSession | null> => {
  const snap = await db().doc(`topics/${topicId}/sessions/0`).get();
  if (!snap.exists) return null;
  const data = snap.data() as {
    totalTurns?: number;
    createdAt: Timestamp;
    completedAt?: Timestamp;
    publishedAt?: Timestamp;
    chapters?: Array<{ chapterId: string; title: string; focusQuestion: string }>;
    currentChapterIndex?: number;
  };
  return {
    id: topicId,
    topicId,
    totalTurns: data.totalTurns ?? null,
    createdAt: data.createdAt?.toDate().toISOString() ?? '',
    completedAt: data.completedAt?.toDate().toISOString() ?? null,
    publishedAt: data.publishedAt?.toDate().toISOString() ?? null,
    chapters: data.chapters,
    currentChapterIndex: data.currentChapterIndex,
  };
};
