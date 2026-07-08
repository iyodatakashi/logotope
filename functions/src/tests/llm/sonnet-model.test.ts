import { describe, it, expect, vi } from 'vitest';

const { doGenerateSpy } = vi.hoisted(() => ({
	doGenerateSpy: vi.fn(async () => ({ content: [], finishReason: 'stop', usage: {} }))
}));

// anthropic(modelId) は最小限の LanguageModelV3 スタブを返す。
// wrapLanguageModel が委譲する doGenerate をスパイし、注入された providerOptions を検証する。
vi.mock('@ai-sdk/anthropic', () => ({
	anthropic: vi.fn((modelId: string) => ({
		specificationVersion: 'v3',
		provider: 'anthropic',
		modelId,
		supportedUrls: {},
		doGenerate: doGenerateSpy
	}))
}));
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: vi.fn(() => vi.fn()) }));

import { anthropic } from '@ai-sdk/anthropic';
import { sonnet } from '../../llm/models.js';
import { AI_MODELS } from '../../constants/ai.constants.js';

describe('AI_MODELS.SONNET', () => {
	it('claude-sonnet-5 に更新されている', () => {
		expect(AI_MODELS.SONNET).toBe('claude-sonnet-5');
	});
});

describe('共有 sonnet モデル', () => {
	it('AI_MODELS.SONNET を anthropic プロバイダで解決する', () => {
		expect(anthropic).toHaveBeenCalledWith(AI_MODELS.SONNET);
	});

	it('生成時に thinking 無効の providerOptions を注入する（4.6 挙動維持）', async () => {
		await (sonnet as { doGenerate: (opts: unknown) => Promise<unknown> }).doGenerate({
			prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
		});
		expect(doGenerateSpy).toHaveBeenCalled();
		const passed = doGenerateSpy.mock.calls[0][0] as { providerOptions?: unknown };
		expect(passed.providerOptions).toEqual({ anthropic: { thinking: { type: 'disabled' } } });
	});
});
