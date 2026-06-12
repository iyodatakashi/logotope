import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import type { LLMType } from '../types/index.js';

const db = () => getFirestore();

// ---- Types ----

export interface DebateTopic {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaProfile {
  id: string;
  topicId: string;
  stakeholderRole: string;
  name: string;
  nationality?: string;
  age: number;
  occupation: string;
  background: string;
  interests: string;
  stanceDirection: string;
  llmType?: LLMType;
  approved: boolean;
  sortOrder: number;
}

export interface PersonaBelief {
  id: string;
  personaId: string;
  version: number;
  content: string;
  changeType?: string | null;
  changeSummary?: string | null;
  triggeredByTurnId?: string | null;
  createdAt: string;
}

export interface DebateSession {
  id: string;
  topicId: string;
  status: string;
  totalTurns?: number | null;
  createdAt: string;
  completedAt?: string | null;
  publishedAt?: string | null;
  chapters?: Array<{ index: number; title: string; focusQuestion: string }>;
  currentChapterIndex?: number;
}

export interface EngagementEntry {
  personaId: string;
  score: number;
  mode: 'full' | 'reaction' | 'none';
}

export interface EngagementHistoryEntry {
  score: number;
  mode: 'full' | 'reaction' | 'none';
  intentSummary?: string;
}

export interface PendingIntentEntry {
  triggerTurnIndex: number;
  intentSummary: string;
}

export interface EngagementDoc {
  history: Record<string, EngagementHistoryEntry>;
  pendingIntents: PendingIntentEntry[];
}

export interface SaveEngagementsParams {
  sessionId: string;
  turnIndex: number;
  assessments: Array<{
    personaId: string;
    score: number;
    mode: 'full' | 'reaction' | 'none';
    intentSummary?: string;
  }>;
}

export interface DebateTurn {
  id: string;
  sessionId: string;
  turnIndex: number;
  speakerType: string;
  personaId?: string | null;
  speakerName?: string;
  speakerRole?: string;
  content: string;
  createdAt: string;
  chapterIndex?: number;
  speechMode?: 'reaction' | 'full';
  fromQueue?: boolean;
  addressedPersonaId?: string;
  engagements?: EngagementEntry[];
}

export interface PersonaInterview {
  id: string;
  personaId: string;
  interviewRecord: string;
  status: string;
  errorMessage?: string | null;
  completedAt?: string | null;
}

export interface CreatePersonaProfileParams {
  topicId: string;
  stakeholderRole: string;
  name: string;
  nationality?: string;
  age: number;
  occupation: string;
  background: string;
  interests: string;
  stanceDirection: string;
  llmType: LLMType;
  sortOrder: number;
}

export interface CreatePersonaBeliefParams {
  topicId: string;
  personaId: string;
  version: number;
  content: string;
  changeType?: string;
  changeSummary?: string;
  triggeredByTurnId?: string;
}

export interface CreateDebateTurnParams {
  sessionId: string;
  turnIndex: number;
  speakerType: string;
  personaId?: string;
  speakerName?: string;
  speakerRole?: string;
  content: string;
  chapterIndex?: number;
  speechMode?: 'reaction' | 'full';
  fromQueue?: boolean;
  addressedPersonaId?: string;
}

export interface CreatePostDebateCommentParams {
  sessionId: string;
  personaId: string;
  content: string;
  sortOrder: number;
}

// ---- Internal helpers ----

const personaDocRef = (topicId: string, personaId: string) =>
  db().doc(`topics/${topicId}/personas/${personaId}`);

// ---- Write functions (AI pipeline) ----

export const updateTopicStatus = async (id: string, status: string): Promise<void> => {
  await db().doc(`topics/${id}`).update({ status, updatedAt: Timestamp.now() });
};

export const createStakeholderMap = async (topicId: string, content: string): Promise<{ id: string }> => {
  const parsed = JSON.parse(content) as { items: unknown[]; approved?: boolean };
  await db().doc(`topics/${topicId}`).update({
    stakeholders: {
      items: parsed.items,
      approved: parsed.approved ?? false,
      createdAt: Timestamp.now(),
    },
    updatedAt: Timestamp.now(),
  });
  return { id: topicId };
};

export const createPersonaProfile = async (params: CreatePersonaProfileParams): Promise<{ id: string }> => {
  const id = nanoid();
  await db().doc(`topics/${params.topicId}/personas/${id}`).set({
    id,
    topicId: params.topicId,
    stakeholderRole: params.stakeholderRole,
    name: params.name,
    ...(params.nationality !== undefined && { nationality: params.nationality }),
    age: params.age,
    occupation: params.occupation,
    background: params.background,
    interests: params.interests,
    stanceDirection: params.stanceDirection,
    llmType: params.llmType,
    approved: false,
    sortOrder: params.sortOrder,
    beliefs: [],
    createdAt: Timestamp.now(),
  });
  return { id };
};

export const queuePersonaInterview = async (topicId: string, personaId: string): Promise<void> => {
  await personaDocRef(topicId, personaId).update({ interview: { status: 'queued' } });
};

export const startPersonaInterview = async (topicId: string, personaId: string): Promise<void> => {
  await personaDocRef(topicId, personaId).update({ interview: { status: 'in_progress' } });
};

export const createCompletedPersonaInterview = async (topicId: string, personaId: string, interviewRecord: string): Promise<{ id: string }> => {
  await personaDocRef(topicId, personaId).update({
    interview: {
      interviewRecord,
      status: 'completed',
      completedAt: Timestamp.now(),
    },
  });
  return { id: personaId };
};

export const createErrorPersonaInterview = async (topicId: string, personaId: string, errorMessage: string): Promise<void> => {
  await personaDocRef(topicId, personaId).update({
    interview: {
      status: 'error',
      errorMessage,
    },
  });
};

export const createPersonaBelief = async (params: CreatePersonaBeliefParams): Promise<{ id: string }> => {
  const ref = personaDocRef(params.topicId, params.personaId);
  const id = nanoid();
  const belief: Record<string, unknown> = {
    id,
    version: params.version,
    content: params.content,
    createdAt: Timestamp.now(),
  };
  if (params.changeType !== undefined) belief.changeType = params.changeType;
  if (params.changeSummary !== undefined) belief.changeSummary = params.changeSummary;
  if (params.triggeredByTurnId !== undefined) belief.triggeredByTurnId = params.triggeredByTurnId;

  await ref.update({
    beliefs: FieldValue.arrayUnion(belief),
  });
  return { id };
};

export const createDebateSession = async (topicId: string): Promise<{ id: string }> => {
  const sessionRef = db().doc(`topics/${topicId}/sessions/0`);
  const snap = await sessionRef.get();
  if (!snap.exists) {
    await sessionRef.set({
      status: 'debating',
      createdAt: Timestamp.now(),
      turns: [],
      postDebateComments: [],
    });
  }
  return { id: topicId };
};

export const completeDebateSession = async (id: string, totalTurns: number): Promise<void> => {
  await db().doc(`topics/${id}/sessions/0`).update({
    status: 'completed',
    totalTurns,
    completedAt: Timestamp.now(),
  });
};

export const createDebateTurn = async (params: CreateDebateTurnParams): Promise<{ id: string }> => {
  const id = nanoid();
  const turn: Record<string, unknown> = {
    id,
    turnIndex: params.turnIndex,
    speakerType: params.speakerType,
    content: params.content,
    createdAt: Timestamp.now(),
  };
  if (params.personaId !== undefined) turn.personaId = params.personaId;
  if (params.speakerName !== undefined) turn.speakerName = params.speakerName;
  if (params.speakerRole !== undefined) turn.speakerRole = params.speakerRole;
  if (params.chapterIndex !== undefined) turn.chapterIndex = params.chapterIndex;
  if (params.speechMode !== undefined) turn.speechMode = params.speechMode;
  if (params.fromQueue) turn.fromQueue = true;
  if (params.addressedPersonaId !== undefined) turn.addressedPersonaId = params.addressedPersonaId;

  await db().doc(`topics/${params.sessionId}/sessions/0`).update({
    turns: FieldValue.arrayUnion(turn),
  });
  return { id };
};

export const saveChapters = async (
  topicId: string,
  chapters: ReadonlyArray<{ index: number; title: string; focusQuestion: string }>
): Promise<void> => {
  await db().doc(`topics/${topicId}/sessions/0`).update({
    chapters: [...chapters],
    currentChapterIndex: 0,
  });
};

export const updateCurrentChapterIndex = async (
  topicId: string,
  index: number
): Promise<void> => {
  await db().doc(`topics/${topicId}/sessions/0`).update({ currentChapterIndex: index });
};

export const createPostDebateComment = async (params: CreatePostDebateCommentParams): Promise<{ id: string }> => {
  const id = nanoid();
  await db().doc(`topics/${params.sessionId}/sessions/0`).update({
    postDebateComments: FieldValue.arrayUnion({
      id,
      personaId: params.personaId,
      content: params.content,
      sortOrder: params.sortOrder,
    }),
  });
  return { id };
};

export const saveEngagements = async (params: SaveEngagementsParams): Promise<void> => {
  for (const assessment of params.assessments) {
    const ref = db().doc(`topics/${params.sessionId}/sessions/0/engagements/${assessment.personaId}`);

    const historyEntry: EngagementHistoryEntry = { score: assessment.score, mode: assessment.mode };
    if (assessment.intentSummary !== undefined) historyEntry.intentSummary = assessment.intentSummary;

    // Map 形式: キーが turnIndex なので同一キーへの上書きで重複を防ぐ（read 不要）
    // キュー（pendingIntents）への書き込みは setPendingIntents に分離している
    await ref.set(
      { history: { [String(params.turnIndex)]: historyEntry } },
      { mergeFields: [`history.${params.turnIndex}`] }
    );
  }
};

export const setPendingIntents = async (
  sessionId: string,
  personaId: string,
  items: ReadonlyArray<PendingIntentEntry>
): Promise<void> => {
  await db().doc(`topics/${sessionId}/sessions/0/engagements/${personaId}`).set(
    { pendingIntents: [...items] },
    { merge: true }
  );
};

export const markSessionError = async (topicId: string): Promise<void> => {
  await db().doc(`topics/${topicId}/sessions/0`).update({ status: 'error' });
};

export const loadPendingIntents = async (sessionId: string): Promise<Map<string, PendingIntentEntry[]>> => {
  const snap = await db().collection(`topics/${sessionId}/sessions/0/engagements`).get();
  const result = new Map<string, PendingIntentEntry[]>();
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as { pendingIntents?: PendingIntentEntry[] };
    result.set(docSnap.id, data.pendingIntents ?? []);
  }
  return result;
};

export interface StakeholderMap {
  id: string;
  topicId: string;
  content: string;
  approved: boolean;
  createdAt: string;
}

export const getStakeholderMapByTopicId = async (topicId: string): Promise<StakeholderMap | null> => {
  const snap = await db().doc(`topics/${topicId}`).get();
  if (!snap.exists) return null;
  const data = snap.data() as { stakeholders?: { items: unknown[]; approved: boolean; createdAt: Timestamp } };
  if (!data.stakeholders) return null;
  return {
    id: topicId,
    topicId,
    content: JSON.stringify(data.stakeholders.items),
    approved: data.stakeholders.approved,
    createdAt: data.stakeholders.createdAt?.toDate().toISOString() ?? '',
  };
};

export const getPersonasByTopicId = async (topicId: string): Promise<PersonaProfile[]> => {
  const snap = await db().collection(`topics/${topicId}/personas`).orderBy('sortOrder', 'asc').get();
  return snap.docs.map((docSnap) => {
    const data = docSnap.data() as PersonaProfile;
    return { ...data, id: docSnap.id };
  });
};

export const getDebateSessionByTopicId = async (topicId: string): Promise<DebateSession | null> => {
  const snap = await db().doc(`topics/${topicId}/sessions/0`).get();
  if (!snap.exists) return null;
  const data = snap.data() as {
    status: string;
    totalTurns?: number;
    createdAt: Timestamp;
    completedAt?: Timestamp;
    publishedAt?: Timestamp;
    chapters?: Array<{ index: number; title: string; focusQuestion: string }>;
    currentChapterIndex?: number;
  };
  return {
    id: topicId,
    topicId,
    status: data.status,
    totalTurns: data.totalTurns ?? null,
    createdAt: data.createdAt?.toDate().toISOString() ?? '',
    completedAt: data.completedAt?.toDate().toISOString() ?? null,
    publishedAt: data.publishedAt?.toDate().toISOString() ?? null,
    chapters: data.chapters,
    currentChapterIndex: data.currentChapterIndex,
  };
};

export const getDebateSessionById = async (id: string): Promise<DebateSession | null> => {
  return getDebateSessionByTopicId(id);
};

export const getDebateTurnsBySessionId = async (sessionId: string): Promise<DebateTurn[]> => {
  const snap = await db().doc(`topics/${sessionId}/sessions/0`).get();
  if (!snap.exists) return [];
  const data = snap.data() as { turns?: Array<{ id: string; turnIndex: number; speakerType: string; personaId?: string; speakerName?: string; speakerRole?: string; content: string; createdAt: Timestamp; chapterIndex?: number; fromQueue?: boolean; addressedPersonaId?: string }> };
  return (data.turns ?? []).map((t) => ({
    id: t.id,
    sessionId,
    turnIndex: t.turnIndex,
    speakerType: t.speakerType,
    personaId: t.personaId ?? null,
    speakerName: t.speakerName,
    speakerRole: t.speakerRole,
    content: t.content,
    createdAt: t.createdAt?.toDate().toISOString() ?? '',
    chapterIndex: t.chapterIndex,
    fromQueue: t.fromQueue,
    addressedPersonaId: t.addressedPersonaId,
  }));
};

export const getPersonaBeliefsByPersonaId = async (topicId: string, personaId: string): Promise<PersonaBelief[]> => {
  const snap = await personaDocRef(topicId, personaId).get();
  if (!snap.exists) return [];
  const data = snap.data() as { beliefs?: Array<{ id: string; version: number; content: string; changeType?: string; changeSummary?: string; triggeredByTurnId?: string; createdAt: Timestamp }> };
  return (data.beliefs ?? []).map((b) => ({
    id: b.id,
    personaId,
    version: b.version,
    content: b.content,
    changeType: b.changeType ?? null,
    changeSummary: b.changeSummary ?? null,
    triggeredByTurnId: b.triggeredByTurnId ?? null,
    createdAt: b.createdAt?.toDate().toISOString() ?? '',
  }));
};

export const getPersonaInterviewByPersonaId = async (topicId: string, personaId: string): Promise<PersonaInterview | null> => {
  const snap = await personaDocRef(topicId, personaId).get();
  if (!snap.exists) return null;
  const data = snap.data() as { interview?: { interviewRecord: string; status: string; errorMessage?: string; completedAt?: Timestamp } };
  if (!data.interview) return null;
  return {
    id: personaId,
    personaId,
    interviewRecord: data.interview.interviewRecord,
    status: data.interview.status,
    errorMessage: data.interview.errorMessage ?? null,
    completedAt: data.interview.completedAt?.toDate().toISOString() ?? null,
  };
};

// ---- Read functions (AI pipeline internal) ----

export const getTopicById = async (id: string): Promise<DebateTopic | null> => {
  const snap = await db().doc(`topics/${id}`).get();
  if (!snap.exists) return null;
  const data = snap.data() as { title: string; status: string; createdAt: Timestamp; updatedAt: Timestamp };
  return {
    id: snap.id,
    title: data.title,
    status: data.status,
    createdAt: data.createdAt?.toDate().toISOString() ?? '',
    updatedAt: data.updatedAt?.toDate().toISOString() ?? '',
  };
};

