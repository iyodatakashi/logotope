export const AI_MODELS = {
	OPUS: 'claude-opus-4-8',
	SONNET: 'claude-sonnet-5'
} as const;

export const PIPELINE_MODELS = {
	factResearch: 'gemini-2.5-pro',
	stakeholderAnalyzer: 'gemini-2.5-pro',
	personaGenerator: 'claude-sonnet-5',
	personaInterview: 'gemini-2.5-pro',
	factCheckAssertionGate: 'gemini-2.5-flash',
	factCheckGrounding: 'gemini-2.5-flash',
	factCheckStructuring: 'gemini-2.5-flash',
	factCheckJudge: 'gemini-2.5-flash'
} as const;

// アバター画像生成モデル。旧 gemini-2.5-flash-image は 2026-10-02 停止予定のため使わない。
// 差し替え時は代表バリエーションでスタイル基準を再確認すること（generation-prompt.md）。
export const AVATAR_IMAGE_MODEL = 'gemini-3.1-flash-image';

export const SEARCH_CONFIG = {
	MAX_RESULTS: 5,
	TIMEOUT_MS: 5000
} as const;
