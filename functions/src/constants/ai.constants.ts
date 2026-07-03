export const AI_MODELS = {
	OPUS: 'claude-opus-4-8',
	SONNET: 'claude-sonnet-4-6'
} as const;

export const PIPELINE_MODELS = {
	factResearch: 'gemini-2.5-pro',
	stakeholderAnalyzer: 'gemini-2.5-pro',
	personaGenerator: 'gpt-5.5',
	personaInterview: 'gemini-2.5-pro',
	factCheckAssertionGate: 'gemini-2.5-flash',
	factCheckGrounding: 'gemini-2.5-pro',
	factCheckStructuring: 'gemini-2.5-flash',
	factCheckJudge: 'gemini-2.5-flash'
} as const;

export const PERSONA_MODELS = {
	claude: 'claude-sonnet-4-6',
	gemini: 'claude-sonnet-4-6',
	gpt: 'gpt-5.5'
} as const satisfies Record<import('../types/common.types.js').LLMType, string>;

export const SEARCH_CONFIG = {
	MAX_RESULTS: 5,
	TIMEOUT_MS: 5000
} as const;
