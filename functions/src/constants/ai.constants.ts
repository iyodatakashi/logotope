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

// アバター画像生成モデル。2.5 は編集（元画像の保持）が弱く、また 2026-10-02 停止予定のため、
// gemini-3.1-flash-image を採用する（ユーザー決定）。単一定義なので変更はここ1箇所。
// ※ design.md は当初 2.5 を検証済みモデルとしていた。3.1 採用はその更新が要る。
export const AVATAR_IMAGE_MODEL = 'gemini-3.1-flash-image';

export const SEARCH_CONFIG = {
	MAX_RESULTS: 5,
	TIMEOUT_MS: 5000
} as const;
