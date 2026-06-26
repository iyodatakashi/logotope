import type { LanguageModel } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import type { LLMType } from '../types/common.types.js';
import { PERSONA_MODELS, PIPELINE_MODELS } from '../constants/ai.constants.js';

export const getPersonaModel = (llmType: LLMType): LanguageModel => {
	switch (llmType) {
		case 'gemini': {
			const apiKey = process.env.GEMINI_API_KEY;
			if (!apiKey) {
				console.warn('[llm] fallback to claude: gemini - GEMINI_API_KEY not set');
				return anthropic(PERSONA_MODELS.claude);
			}
			return createGoogleGenerativeAI({ apiKey })(PERSONA_MODELS.gemini);
		}
		case 'gpt':
			if (!process.env.OPENAI_API_KEY) {
				console.warn('[llm] fallback to claude: gpt - OPENAI_API_KEY not set');
				return anthropic(PERSONA_MODELS.claude);
			}
			return openai(PERSONA_MODELS.gpt);
		case 'claude':
			return anthropic(PERSONA_MODELS.claude);
	}
};

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
