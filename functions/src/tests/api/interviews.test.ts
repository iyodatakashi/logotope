/**
 * runInterview onCall のユニットテスト（Task 5.1）。
 * 取材成功時は当該ペルソナ文書へ interview（completed）と beliefs[0] をサーバ永続化し、
 * 全件完了判定（confirmInterviewsGeneratedIfAllComplete）を起動して空レスポンス {} を返す。
 * 取材失敗時は当該ペルソナを error 状態で永続化したうえで HttpsError(internal) を投げる。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFirestoreMock } from '../helpers/firestore-mock.js';

const mockRunInterviewAgent = vi.hoisted(() => vi.fn());
const mockConfirmInterviews = vi.hoisted(() => vi.fn());
const mockGetTopicContext = vi.hoisted(() => vi.fn());

const { holder } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	}
}));

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

vi.mock('../../pipeline/topics/topic-context.js', () => ({
	getTopicContext: mockGetTopicContext
}));

vi.mock('../../pipeline/interviews/interview-completion.js', () => ({
	confirmInterviewsGeneratedIfAllComplete: mockConfirmInterviews
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	Timestamp: { now: () => 'TS' }
}));

import { runInterview } from '../../api/interviews.js';

const TOPIC_ID = 'topic1';
const PERSONA_ID = 'p1';
const TITLE = 'AIと社会';
const makeRequest = (data: unknown) => ({ data, auth: { uid: 'user1' } });
const handler = runInterview as unknown as (req: unknown) => Promise<unknown>;
const persona = () => holder.mock!.store.get(`topics/${TOPIC_ID}/personas/${PERSONA_ID}`);

const mockPersona = {
	name: '田中太郎',
	age: 40,
	occupation: '会社員',
	stakeholderRole: '一般',
	specificRole: '会社員',
	background: '東京在住',
	interests: 'テクノロジー'
};

const validData = (overrides: Record<string, unknown> = {}) => ({
	topicId: TOPIC_ID,
	personaId: PERSONA_ID,
	topicTitle: TITLE,
	persona: mockPersona,
	...overrides
});

const agentOutput = {
	draftBelief: { stanceAndGrounds: 's' },
	verificationReport: 'report',
	interviewRecord: 'record',
	initialBelief: 'belief',
	sources: [{ query: 'q', summary: 'sum', results: [] }]
};

beforeEach(() => {
	vi.clearAllMocks();
	holder.mock = createFirestoreMock();
	holder.mock.store.set(`topics/${TOPIC_ID}/personas/${PERSONA_ID}`, { sortOrder: 0 });
	mockGetTopicContext.mockResolvedValue({});
});

describe('runInterview handler', () => {
	it('topicId がない場合は invalid-argument エラーを投げる', async () => {
		await expect(handler(makeRequest(validData({ topicId: undefined })))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('personaId がない場合は invalid-argument エラーを投げる', async () => {
		await expect(handler(makeRequest(validData({ personaId: undefined })))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('topicTitle がない場合は invalid-argument エラーを投げる', async () => {
		await expect(handler(makeRequest(validData({ topicTitle: undefined })))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('persona がない場合は invalid-argument エラーを投げる', async () => {
		await expect(handler(makeRequest(validData({ persona: undefined })))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('取材成功時に interview(completed)と beliefs[0] を永続化し、全件確定を起動して {} を返す', async () => {
		mockRunInterviewAgent.mockResolvedValueOnce({ ok: true, value: agentOutput });
		mockConfirmInterviews.mockResolvedValueOnce(true);

		const result = await handler(makeRequest(validData()));

		expect(result).toEqual({});
		expect(persona()?.interview).toMatchObject({
			draftBelief: agentOutput.draftBelief,
			verificationReport: 'report',
			interviewRecord: 'record',
			sources: agentOutput.sources,
			status: 'completed',
			completedAt: 'TS'
		});
		expect(persona()?.beliefs).toEqual([{ version: 0, content: 'belief', createdAt: 'TS' }]);
		expect(mockConfirmInterviews).toHaveBeenCalledWith(TOPIC_ID);
	});

	it('事実基盤を含む共有コンテキストをサーバ権威（getTopicContext）で取得し取材に渡す（FEからは渡さない）', async () => {
		const serverContext = {
			factBase: {
				facts: [{ statement: '確定事実', sources: [] }],
				generatedAt: new Date('2026-07-03T00:00:00Z')
			}
		};
		mockGetTopicContext.mockResolvedValueOnce(serverContext);
		mockRunInterviewAgent.mockResolvedValueOnce({ ok: true, value: agentOutput });
		mockConfirmInterviews.mockResolvedValueOnce(true);

		// FE が factBase 付きの topicContext を渡しても、サーバは getTopicContext の値を使う
		await handler(
			makeRequest(validData({ topicContext: { factBase: { facts: [], generatedAt: new Date() } } }))
		);

		expect(mockGetTopicContext).toHaveBeenCalledWith(TOPIC_ID);
		const [, , passedContext] = mockRunInterviewAgent.mock.calls[0];
		expect(passedContext).toEqual(serverContext);
	});

	it('取材失敗時は当該ペルソナを error 状態で永続化し HttpsError(internal) を投げる', async () => {
		mockRunInterviewAgent.mockResolvedValueOnce({
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'API failed', retryable: true }
		});

		await expect(handler(makeRequest(validData()))).rejects.toMatchObject({ code: 'internal' });

		expect(persona()?.interview).toEqual({ status: 'error', errorMessage: 'API failed' });
		expect(mockConfirmInterviews).not.toHaveBeenCalled();
	});
});
