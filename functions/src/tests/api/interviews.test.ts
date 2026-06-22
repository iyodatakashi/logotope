import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRunInterviewAgent = vi.hoisted(() => vi.fn());

vi.mock('firebase-functions/v2/https', () => ({
	onCall: vi.fn((_opts: unknown, handler: unknown) => handler),
	HttpsError: class HttpsError extends Error {
		constructor(
			public code: string,
			message: string
		) {
			super(message);
		}
	}
}));

vi.mock('../../utils/auth.js', () => ({
	requireAuth: vi.fn()
}));

vi.mock('../../agents/interview-agent.js', () => ({
	runInterview: mockRunInterviewAgent
}));

import { runInterview } from '../../api/interviews.js';
import type { Persona } from '../../types/persona.types.js';

const mockPersona: Persona = {
	id: 'p1',
	topicId: 'topic1',
	name: '田中太郎',
	age: 40,
	occupation: '会社員',
	stakeholderRole: '一般',
	specificRole: '会社員',
	background: '東京在住',
	interests: 'テクノロジー',
	nationality: '日本',
	engagementLevel: 'moderate',
	llmType: 'claude',
	approved: true,
	sortOrder: 0,
	interviewRecord: ''
};

const makeRequest = (data: unknown) => ({ data, auth: { uid: 'user1' } });
const handler = runInterview as unknown as (req: unknown) => Promise<unknown>;

describe('interviews.ts runInterview handler', () => {
	beforeEach(() => vi.clearAllMocks());

	it('topicTitleがない場合はinvalid-argumentエラーを投げる', async () => {
		await expect(handler(makeRequest({ persona: mockPersona }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('personaがない場合はinvalid-argumentエラーを投げる', async () => {
		await expect(handler(makeRequest({ topicTitle: 'AIと社会' }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('runInterviewAgentがエラー結果のときHttpsError(internal)を投げる', async () => {
		mockRunInterviewAgent.mockResolvedValueOnce({
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'API failed', retryable: true }
		});
		await expect(
			handler(makeRequest({ topicTitle: 'AIと社会', persona: mockPersona }))
		).rejects.toMatchObject({ code: 'internal' });
	});

	it('runInterviewAgentが成功結果のときその値を返す', async () => {
		const mockOutput = { interviewRecord: 'record', initialBelief: 'belief', sources: [] };
		mockRunInterviewAgent.mockResolvedValueOnce({ ok: true, value: mockOutput });
		const result = await handler(makeRequest({ topicTitle: 'AIと社会', persona: mockPersona }));
		expect(result).toEqual(mockOutput);
	});
});
