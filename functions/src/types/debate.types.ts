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
