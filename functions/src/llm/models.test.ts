import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGoogleModelFn } = vi.hoisted(() => ({
  mockGoogleModelFn: vi.fn(),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((modelId: string) => ({ _provider: 'anthropic', _modelId: modelId })),
}));
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => mockGoogleModelFn),
}));
vi.mock('@ai-sdk/openai', () => ({
  openai: vi.fn((modelId: string) => ({ _provider: 'openai', _modelId: modelId })),
}));
import { anthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { getPersonaModel } from './models.js';
import { PERSONA_MODELS } from '../constants/ai.constants.js';

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

describe('getPersonaModel', () => {
  describe('claude', () => {
    it('Claude LanguageModel を返す', () => {
      getPersonaModel('claude');
      expect(anthropic).toHaveBeenCalledWith(PERSONA_MODELS.claude);
    });
  });

  describe('gemini', () => {
    it('GEMINI_API_KEY が設定されている場合 Gemini LanguageModel を返す', () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      getPersonaModel('gemini');
      expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'test-gemini-key' });
      expect(mockGoogleModelFn).toHaveBeenCalledWith(PERSONA_MODELS.gemini);
      expect(anthropic).not.toHaveBeenCalled();
    });

    it('GEMINI_API_KEY が未設定の場合 Claude にフォールバック', () => {
      getPersonaModel('gemini');
      expect(anthropic).toHaveBeenCalledWith(PERSONA_MODELS.claude);
      expect(createGoogleGenerativeAI).not.toHaveBeenCalled();
    });
  });

  describe('gpt', () => {
    it('OPENAI_API_KEY が設定されている場合 OpenAI LanguageModel を返す', () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      getPersonaModel('gpt');
      expect(openai).toHaveBeenCalledWith(PERSONA_MODELS.gpt);
      expect(anthropic).not.toHaveBeenCalled();
    });

    it('OPENAI_API_KEY が未設定の場合 Claude にフォールバック', () => {
      getPersonaModel('gpt');
      expect(anthropic).toHaveBeenCalledWith(PERSONA_MODELS.claude);
      expect(openai).not.toHaveBeenCalled();
    });
  });
});
