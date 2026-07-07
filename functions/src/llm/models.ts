import type { LanguageModel } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import type { LLMType } from '../types/common.types.js';
import { PERSONA_MODELS, PIPELINE_MODELS } from '../constants/ai.constants.js';

// プロバイダは llmType キーではなく「解決後のモデル ID」で選ぶ。
// これにより、ペルソナ設定が gemini でもモデル ID が Claude(Sonnet) を指していれば anthropic に投げる
// （過去の不具合対応で gemini ペルソナを Sonnet に寄せた設定を正しく機能させる。Google に Claude ID を渡さない）。
const providerForModel = (modelId: string): LanguageModel => {
	if (modelId.startsWith('claude')) return anthropic(modelId);
	if (modelId.startsWith('gpt')) {
		if (!process.env.OPENAI_API_KEY) {
			console.warn(`[llm] fallback to claude: ${modelId} - OPENAI_API_KEY not set`);
			return anthropic(PERSONA_MODELS.claude);
		}
		return openai(modelId);
	}
	if (modelId.startsWith('gemini')) {
		const apiKey = process.env.GEMINI_API_KEY;
		if (!apiKey) {
			console.warn(`[llm] fallback to claude: ${modelId} - GEMINI_API_KEY not set`);
			return anthropic(PERSONA_MODELS.claude);
		}
		return createGoogleGenerativeAI({ apiKey })(modelId);
	}
	console.warn(`[llm] fallback to claude: unknown model ${modelId}`);
	return anthropic(PERSONA_MODELS.claude);
};

export const getPersonaModel = (llmType: LLMType): LanguageModel =>
	providerForModel(PERSONA_MODELS[llmType]);

export const getGoogleProvider = (): ReturnType<typeof createGoogleGenerativeAI> | null => {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) return null;
	return createGoogleGenerativeAI({ apiKey });
};

export const getPipelineModel = (task: keyof typeof PIPELINE_MODELS): LanguageModel => {
	const modelId = PIPELINE_MODELS[task];
	switch (task) {
		case 'stakeholderAnalyzer': {
			const apiKey = process.env.GEMINI_API_KEY;
			if (!apiKey) {
				console.warn('[llm] fallback to claude: stakeholderAnalyzer - GEMINI_API_KEY not set');
				return anthropic(PERSONA_MODELS.claude);
			}
			return createGoogleGenerativeAI({ apiKey })(modelId);
		}
		case 'personaGenerator':
			if (!process.env.OPENAI_API_KEY) {
				console.warn('[llm] fallback to claude: personaGenerator - OPENAI_API_KEY not set');
				return anthropic(PERSONA_MODELS.claude);
			}
			return openai(modelId);
		case 'personaInterview': {
			const apiKey = process.env.GEMINI_API_KEY;
			if (!apiKey) {
				console.warn('[llm] fallback to claude: personaInterview - GEMINI_API_KEY not set');
				return anthropic(PERSONA_MODELS.claude);
			}
			return createGoogleGenerativeAI({ apiKey })(modelId);
		}
		case 'factResearch':
		case 'factCheckAssertionGate':
		case 'factCheckGrounding':
		case 'factCheckStructuring':
		case 'factCheckJudge': {
			const apiKey = process.env.GEMINI_API_KEY;
			if (!apiKey) {
				console.warn(`[llm] fallback to claude: ${task} - GEMINI_API_KEY not set`);
				return anthropic(PERSONA_MODELS.claude);
			}
			return createGoogleGenerativeAI({ apiKey })(modelId);
		}
	}
};
