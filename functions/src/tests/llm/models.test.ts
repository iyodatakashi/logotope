import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGoogleModelFn } = vi.hoisted(() => ({
	mockGoogleModelFn: vi.fn()
}));

vi.mock('@ai-sdk/anthropic', () => ({
	anthropic: vi.fn((modelId: string) => ({ _provider: 'anthropic', _modelId: modelId }))
}));
vi.mock('@ai-sdk/google', () => ({
	createGoogleGenerativeAI: vi.fn(() => mockGoogleModelFn)
}));
import { anthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { getPipelineModel, sonnet } from '../../llm/models.js';
import { PIPELINE_MODELS } from '../../constants/ai.constants.js';

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of ['GEMINI_API_KEY', 'OPENAI_API_KEY']) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(() => {
	for (const [key, val] of Object.entries(savedEnv)) {
		if (val !== undefined) process.env[key] = val;
		else delete process.env[key];
	}
});

describe('getPipelineModel - personaGenerator', () => {
	it('OPENAI_API_KEY の有無によらず共有 sonnet を返す（Claude 化）', () => {
		process.env.OPENAI_API_KEY = 'test-openai-key';
		expect(getPipelineModel('personaGenerator')).toBe(sonnet);
		expect(createGoogleGenerativeAI).not.toHaveBeenCalled();
	});
});

describe('getPipelineModel - ファクトチェック', () => {
	beforeEach(() => {
		process.env.GEMINI_API_KEY = 'test-gemini-key';
	});

	it('factCheckGrounding は Gemini プロバイダ（gemini-2.5-pro）を返す', () => {
		getPipelineModel('factCheckGrounding');
		expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'test-gemini-key' });
		expect(mockGoogleModelFn).toHaveBeenCalledWith(PIPELINE_MODELS.factCheckGrounding);
		expect(anthropic).not.toHaveBeenCalled();
	});

	it('factCheckStructuring は Gemini プロバイダ（gemini-2.5-flash）を返す', () => {
		getPipelineModel('factCheckStructuring');
		expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'test-gemini-key' });
		expect(mockGoogleModelFn).toHaveBeenCalledWith(PIPELINE_MODELS.factCheckStructuring);
		expect(anthropic).not.toHaveBeenCalled();
	});

	it('factCheckAssertionGate は Gemini プロバイダ（gemini-2.5-flash）を返す', () => {
		getPipelineModel('factCheckAssertionGate');
		expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'test-gemini-key' });
		expect(mockGoogleModelFn).toHaveBeenCalledWith(PIPELINE_MODELS.factCheckAssertionGate);
		expect(anthropic).not.toHaveBeenCalled();
	});

	it('factCheckAssertionGate は GEMINI_API_KEY 未設定なら共有 sonnet にフォールバック', () => {
		delete process.env.GEMINI_API_KEY;
		expect(getPipelineModel('factCheckAssertionGate')).toBe(sonnet);
		expect(createGoogleGenerativeAI).not.toHaveBeenCalled();
	});

	it('factCheckJudge は Gemini プロバイダを返す', () => {
		getPipelineModel('factCheckJudge');
		expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'test-gemini-key' });
		expect(mockGoogleModelFn).toHaveBeenCalledWith(PIPELINE_MODELS.factCheckJudge);
		expect(anthropic).not.toHaveBeenCalled();
	});

	it('factCheckJudge は GEMINI_API_KEY 未設定なら共有 sonnet にフォールバック', () => {
		delete process.env.GEMINI_API_KEY;
		expect(getPipelineModel('factCheckJudge')).toBe(sonnet);
		expect(createGoogleGenerativeAI).not.toHaveBeenCalled();
	});
});
