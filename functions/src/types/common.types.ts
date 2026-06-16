export type LLMType = 'gemini' | 'claude' | 'gpt';
export type PhaseStatus = 'not_started' | 'running' | 'generated' | 'stopped';

export type InterviewResult = {
  personaId: string;
  interviewRecord: string;
  initialBelief: string;
  status: 'completed' | 'error';
  errorMessage?: string;
};

export type PersonaResearchResult = {
  personaId: string;
  researchSummary: string;
  initialBelief: string;
  status: 'completed' | 'error';
  errorMessage?: string;
};

export type PipelineError =
  | { code: 'AI_API_ERROR'; message: string; retryable: boolean }
  | { code: 'VALIDATION_ERROR'; message: string; field?: string }
  | { code: 'NOT_FOUND'; resource: string }
  | { code: 'INVALID_STATE'; current: string; expected: string };

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };
