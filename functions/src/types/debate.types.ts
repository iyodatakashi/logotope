import type { Persona } from './persona.types.js';

export type BeliefChangeType = 'opinion_change' | 'partial_acceptance';
export type SpeakerType = 'facilitator' | 'persona';
export type SpeakerSource = 'nomination' | 'direct_address' | 'queue' | 'score';

export type BeliefChangeEvent = {
  type: BeliefChangeType;
  summary: string;
  updatedBelief: string;
};

export type AgentTurnResult = {
  content: string;
  speechMode?: 'opinion' | 'fact';
  beliefChange: BeliefChangeEvent | null;
  addressedToPersonaId?: string;
  searchUsed?: boolean;
  searchQueries?: string[];
};

export type PostDebateCommentResult = {
  personaId: string;
  content: string;
};

export type FacilitatorOpeningResult = {
  content: string;
  firstPersonaId: string;
};

export type FacilitatorIntervention = {
  shouldIntervene: boolean;
  content?: string;
  targetPersonaId?: string;
};

export type EngagementAssessment = {
  score: number;
  mode: 'opinion' | 'fact' | 'none';
  intentSummary?: string;
};

export type PendingIntent = {
  triggerTurnIndex: number;
  intentSummary: string;
};

export type SpeakerDecision = {
  personaId: string;
  source: SpeakerSource;
  mode?: 'opinion' | 'fact';
  score?: number;
  intentSummary?: string;
};

export type DebateChapter = {
  chapterId: string;
  title: string;
  focusQuestion: string;
};

export type DirectAddressInput = {
  pendingAddress?: { personaId: string; byFacilitator: boolean };
  consecutiveDirectExchanges: number;
  personaIds: ReadonlyArray<string>;
};

export type SpeakerAssessment = {
  personaId: string;
  score: number;
  mode: 'opinion' | 'fact' | 'none';
  intentSummary?: string;
};

export type SpeakerSelectionInput = {
  assessments: ReadonlyArray<SpeakerAssessment>;
  pendingIntents: ReadonlyMap<string, ReadonlyArray<PendingIntent>>;
  silenceMap: ReadonlyMap<string, number>;
  lastSpeakerId?: string;
  personaIds: ReadonlyArray<string>;
};

export type ChapterEndInput = {
  chapterTurnCount: number;
  targetTurns: number;
  engagementSignals: ReadonlyArray<0 | 1>;
};

export type InterventionPolicyInput = {
  personaTurnsSinceFacilitator: number;
  cooldownTurns: number;
};

export type DebateState = {
  history: DebateTurn[];
  currentBeliefs: Map<string, { content: string; version: number }>;
  silenceMap: Map<string, number>;
  speakCount: Map<string, number>;
  pendingAddress?: { personaId: string; byFacilitator: boolean };
  lastSpeakerId?: string;
  pendingIntents: Map<string, PendingIntent[]>;
  consecutiveDirectExchanges: number;
  engagementSignals: Array<0 | 1>;
  currentTurnIndex: number;
  lastFacilitatorTurnIndex: number;
};

export type RestoreInput = {
  turns: ReadonlyArray<DebateTurn>;
  personas: ReadonlyArray<Persona>;
  persistedPendingIntents: ReadonlyMap<string, ReadonlyArray<PendingIntent>>;
  currentBeliefs: Map<string, { content: string; version: number }>;
};

export type TurnGenerationContext = {
  chapterHistory: ReadonlyArray<DebateTurn>;
  chapter: DebateChapter;
  mode?: 'opinion' | 'fact';
  score?: number;
  intentSummary?: string;
  pendingTrigger?: { speakerName: string; content: string };
  nominatedByFacilitator: boolean;
};

export type OrchestratorOptions = {
  turnsPerChapter: number;
  maxTurns: number;
  interventionCooldown: number;
  singleChapterMode?: boolean;
};

export type DebateTopic = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
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
