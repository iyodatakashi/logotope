import type { LLMType } from './common.types.js';

export type DebateTopic = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type PersonaProfile = {
  id: string;
  topicId: string;
  stakeholderRole: string;
  specificRole: string;
  name: string;
  nationality?: string;
  age: number;
  occupation: string;
  background: string;
  interests: string;
  llmType?: LLMType;
  approved: boolean;
  sortOrder: number;
};

export type PersonaBelief = {
  id: string;
  personaId: string;
  version: number;
  content: string;
  changeType?: string | null;
  changeSummary?: string | null;
  triggeredByTurnId?: string | null;
  createdAt: string;
};

export type DebateSession = {
  id: string;
  topicId: string;
  totalTurns?: number | null;
  createdAt: string;
  completedAt?: string | null;
  publishedAt?: string | null;
  chapters?: Array<{ chapterId: string; title: string; focusQuestion: string }>;
  currentChapterIndex?: number;
};

export type EngagementEntry = {
  personaId: string;
  score: number;
  mode: 'opinion' | 'fact' | 'none';
};

export type EngagementHistoryEntry = {
  score: number;
  mode: 'opinion' | 'fact' | 'none';
  intentSummary?: string;
};

export type PendingIntentEntry = {
  triggerTurnIndex: number;
  intentSummary: string;
};

export type EngagementDoc = {
  history: Record<string, EngagementHistoryEntry>;
  pendingIntents: PendingIntentEntry[];
};

export type SaveEngagementsParams = {
  sessionId: string;
  turnIndex: number;
  assessments: Array<{
    personaId: string;
    score: number;
    mode: 'opinion' | 'fact' | 'none';
    intentSummary?: string;
  }>;
};

export type DebateTurn = {
  id: string;
  sessionId: string;
  turnIndex: number;
  speakerType: string;
  personaId?: string | null;
  speakerName?: string;
  speakerRole?: string;
  content: string;
  createdAt: string;
  chapterId?: string;
  speechMode?: 'opinion' | 'fact';
  engagementScore?: number;
  fromQueue?: boolean;
  addressedPersonaId?: string;
  engagements?: EngagementEntry[];
  searchUsed?: boolean;
  searchQueries?: string[];
};

export type PersonaInterview = {
  id: string;
  personaId: string;
  interviewRecord: string;
  status: string;
  errorMessage?: string | null;
  completedAt?: string | null;
};

export type CreatePersonaProfileParams = {
  topicId: string;
  stakeholderRole: string;
  name: string;
  nationality?: string;
  age: number;
  occupation: string;
  background: string;
  interests: string;
  llmType: LLMType;
  sortOrder: number;
};

export type CreatePersonaBeliefParams = {
  topicId: string;
  personaId: string;
  version: number;
  content: string;
  changeType?: string;
  changeSummary?: string;
  triggeredByTurnId?: string;
};

export type CreateDebateTurnParams = {
  sessionId: string;
  turnIndex: number;
  speakerType: string;
  personaId?: string;
  speakerName?: string;
  speakerRole?: string;
  content: string;
  chapterId?: string;
  speechMode?: 'opinion' | 'fact';
  engagementScore?: number;
  fromQueue?: boolean;
  addressedPersonaId?: string;
  searchUsed?: boolean;
  searchQueries?: string[];
};

export type CreatePostDebateCommentParams = {
  sessionId: string;
  personaId: string;
  content: string;
  sortOrder: number;
};

export type StakeholderMap = {
  id: string;
  topicId: string;
  content: string;
};
