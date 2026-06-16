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
