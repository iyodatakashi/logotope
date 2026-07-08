import type { LanguageModel } from 'ai';
import { wrapLanguageModel, defaultSettingsMiddleware } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { AI_MODELS, PIPELINE_MODELS } from '../constants/ai.constants.js';

// 全 Sonnet 利用経路が共有する解決済みモデル。
// thinking 無効（4.6 挙動維持）を1定義に集約し、各エージェントに散らさない。
export const sonnet: LanguageModel = wrapLanguageModel({
	model: anthropic(AI_MODELS.SONNET),
	middleware: defaultSettingsMiddleware({
		settings: {
			providerOptions: {
				anthropic: {
					thinking: { type: 'disabled' }
				}
			}
		}
	})
});

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
				return sonnet;
			}
			return createGoogleGenerativeAI({ apiKey })(modelId);
		}
		case 'personaGenerator':
			return sonnet;
		case 'personaInterview': {
			const apiKey = process.env.GEMINI_API_KEY;
			if (!apiKey) {
				console.warn('[llm] fallback to claude: personaInterview - GEMINI_API_KEY not set');
				return sonnet;
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
				return sonnet;
			}
			return createGoogleGenerativeAI({ apiKey })(modelId);
		}
	}
};
