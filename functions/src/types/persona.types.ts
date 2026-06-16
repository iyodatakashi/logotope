import type { EngagementLevel } from './stakeholder.types.js';
import type { LLMType } from './common.types.js';

export type Persona = {
  stakeholderRole: string;
  specificRole: string;
  name: string;
  nationality: string;
  age: number;
  occupation: string;
  background: string;
  interests: string;
  engagementLevel: EngagementLevel;
  llmType: LLMType;
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
