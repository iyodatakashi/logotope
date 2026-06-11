export const AI_MODELS = {
  OPUS: 'claude-opus-4-8',
  SONNET: 'claude-sonnet-4-6',
} as const;

export const PIPELINE_MODELS = {
  stakeholderAnalyzer: 'gemini-2.5-pro',
  personaGenerator: 'gpt-5.5',
  personaResearch: 'claude-opus-4-8',
} as const;

export const PERSONA_MODELS = {
  claude: 'claude-sonnet-4-6',
  gemini: 'gemini-2.5-pro',
  gpt: 'gpt-5.5',
} as const satisfies Record<import('../types/index.js').LLMType, string>;

export const MAX_TOKENS = {
  STAKEHOLDER: 4096,
  PERSONA: 8192,
  INTERVIEW: 8192,
  FACILITATOR_OPENING: 1024,
  FACILITATOR_SELECT: 256,
  FACILITATOR_INTERVENTION: 512,
  FACILITATOR_CLOSING: 1024,
  FACILITATOR_CHAPTER_ISSUES: 2048,
  FACILITATOR_CHAPTER_STRUCTURE: 2048,
  FACILITATOR_CHAPTER_END: 256,
  FACILITATOR_CHAPTER_TRANSITION: 512,
  PERSONA_TURN: 512,
  PERSONA_ENGAGEMENT: 128,
  PERSONA_POST_DEBATE: 512,
} as const;
