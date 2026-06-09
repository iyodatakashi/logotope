export type DebateStatus =
  | 'pending'
  | 'surveying'
  | 'generating_personas'
  | 'interviewing'
  | 'debating'
  | 'completed'
  | 'published';

export type MinorityLevel = 'high' | 'medium' | 'low';
export type StanceDirection = 'pro' | 'against' | 'conditional' | 'neutral';
export type BeliefChangeType = 'opinion_change' | 'partial_acceptance';
export type SpeakerType = 'facilitator' | 'persona';

export interface Stakeholder {
  role: string;
  reason: string;
  mainInterests: string[];
  stanceDirection: StanceDirection;
  minorityLevel: MinorityLevel;
}

export interface PersonaAttributes {
  id: string;
  stakeholderRole: string;
  name: string;
  age: number;
  occupation: string;
  background: string;
  interests: string;
  stanceDirection: string;
}

export interface ConversationTurn {
  turnId: string;
  turnIndex: number;
  speakerType: SpeakerType;
  personaId?: string;
  speakerName: string;
  speakerRole: string;
  content: string;
}

export interface BeliefChangeEvent {
  type: BeliefChangeType;
  summary: string;
  updatedBelief: string;
}

export interface AgentTurnResult {
  content: string;
  beliefChange: BeliefChangeEvent | null;
  addressedToPersonaId?: string;
}

export interface InterviewResult {
  personaId: string;
  interviewRecord: string;
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
  type?: 'topic_shift' | 'invite' | 'close';
  targetPersonaId?: string;
}

export interface DebateChapter {
  index: number;
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
