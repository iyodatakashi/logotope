import type { DebateTurn, PersonaProfile } from './repository.types.js';

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
  personas: ReadonlyArray<PersonaProfile>;
  persistedPendingIntents: ReadonlyMap<string, ReadonlyArray<PendingIntent>>;
  currentBeliefs: Map<string, { content: string; version: number }>;
};

export type OrchestratorOptions = {
  turnsPerChapter: number;
  maxTurns: number;
  interventionCooldown: number;
  singleChapterMode?: boolean;
};
