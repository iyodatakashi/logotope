export type LLMType = 'gemini' | 'claude' | 'gpt';

export type PhaseStatus = 'not_started' | 'running' | 'generated' | 'stopped';

export type MinorityLevel = 'high' | 'medium' | 'low';
export type EngagementLevel = 'high' | 'medium' | 'low';
export type BeliefChangeType = 'opinion_change' | 'partial_acceptance';
export type SpeakerType = 'facilitator' | 'persona';

export interface Stakeholder {
  role: string;
  reason: string;
  mainInterests: string[];
  minorityLevel: MinorityLevel;
  engagementLevel?: EngagementLevel;
}

export interface PersonaAttributes {
  id: string;
  stakeholderRole: string;
  specificRole: string;
  name: string;
  nationality?: string;
  age: number;
  occupation: string;
  background: string;
  interests: string;
  engagementLevel?: EngagementLevel;
  llmType?: LLMType;
}

export interface BeliefChangeEvent {
  type: BeliefChangeType;
  summary: string;
  updatedBelief: string;
}

export interface AgentTurnResult {
  content: string;
  speechMode?: 'opinion' | 'fact';
  beliefChange: BeliefChangeEvent | null;
  addressedToPersonaId?: string;
  searchUsed?: boolean;
  searchQueries?: string[];
}

export interface InterviewResult {
  personaId: string;
  interviewRecord: string;
  initialBelief: string;
  status: 'completed' | 'error';
  errorMessage?: string;
}

export interface PersonaResearchResult {
  personaId: string;
  researchSummary: string;
  initialBelief: string;
  status: 'completed' | 'error';
  errorMessage?: string;
}

export interface PostDebateCommentResult {
  personaId: string;
  content: string;
}

export interface FacilitatorOpeningResult {
  content: string;
  firstPersonaId: string;
}

export interface FacilitatorIntervention {
  shouldIntervene: boolean;
  content?: string;
  targetPersonaId?: string;
}

export interface EngagementAssessment {
  score: number;
  mode: 'opinion' | 'fact' | 'none';
  intentSummary?: string;
}

export interface PendingIntent {
  triggerTurnIndex: number;
  intentSummary: string;
}

export type SpeakerSource = 'nomination' | 'direct_address' | 'queue' | 'score';

export interface SpeakerDecision {
  personaId: string;
  source: SpeakerSource;
  mode?: 'opinion' | 'fact';
  score?: number;
  intentSummary?: string;
}

export interface DebateChapter {
  title: string;
  focusQuestion: string;
  startTurnIndex: number;
  endTurnIndex?: number;
}

export type PipelineError =
  | { code: 'AI_API_ERROR'; message: string; retryable: boolean }
  | { code: 'VALIDATION_ERROR'; message: string; field?: string }
  | { code: 'NOT_FOUND'; resource: string }
  | { code: 'INVALID_STATE'; current: string; expected: string };

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };
