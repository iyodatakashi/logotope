/**
 * generateStakeholders onCall のユニットテスト（Task 2）。
 * 生成物のサーバ永続化と、共通ヘルパー confirmPhaseGenerated による
 * running→generated 限定の冪等確定を、インメモリ Firestore 上で検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFirestoreMock } from '../helpers/firestore-mock.js';

const mockRunStakeholderGeneration = vi.hoisted(() => vi.fn());

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

vi.mock('../../agents/stakeholder-agent.js', () => ({
	generateStakeholders: mockRunStakeholderGeneration
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	Timestamp: { now: () => 'TS' }
}));

import { generateStakeholders } from '../../api/stakeholders.js';

const TOPIC_ID = 'topic1';
const TITLE = 'AIと社会';
const makeRequest = (data: unknown) => ({ data, auth: { uid: 'user1' } });
const handler = generateStakeholders as unknown as (req: unknown) => Promise<unknown>;
const topic = () => holder.mock!.store.get(`topics/${TOPIC_ID}`);
const stakeholders = () => holder.mock!.store.get(`topics/${TOPIC_ID}/stakeholders/0`);

beforeEach(() => {
	vi.clearAllMocks();
	holder.mock = createFirestoreMock();
});

describe('generateStakeholders handler', () => {
	it('topicIdがない場合はinvalid-argumentエラーを投げる', async () => {
		await expect(handler(makeRequest({ title: TITLE }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('titleがない場合はinvalid-argumentエラーを投げる', async () => {
		await expect(handler(makeRequest({ topicId: TOPIC_ID }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('生成成功時に stakeholders を永続化し、confirmPhaseGenerated で generated を確定する', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'stakeholders', phaseStatus: 'running' });
		mockRunStakeholderGeneration.mockResolvedValueOnce({
			ok: true,
			value: { stakeholders: ['s1', 's2'] }
		});

		const result = await handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }));

		expect(result).toEqual({});
		expect(stakeholders()).toEqual({ stakeholders: ['s1', 's2'] });
		expect(topic()?.phase).toBe('stakeholders');
		expect(topic()?.phaseStatus).toBe('generated');
	});

	it('承認済み事実基盤が存在すれば topicContext.factBase を抽出に渡す', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'stakeholders', phaseStatus: 'running' });
		holder.mock!.store.set(`topics/${TOPIC_ID}/factBase/0`, {
			facts: [{ statement: '確定事実', sources: [] }],
			generatedAt: { toDate: () => new Date('2026-07-03T00:00:00Z') }
		});
		mockRunStakeholderGeneration.mockResolvedValueOnce({
			ok: true,
			value: { stakeholders: ['s1'] }
		});

		await handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }));

		const [passedTitle, topicContext] = mockRunStakeholderGeneration.mock.calls[0];
		expect(passedTitle).toBe(TITLE);
		expect(topicContext.factBase.facts).toEqual([{ statement: '確定事実', sources: [] }]);
	});

	it('事実基盤が無ければ factBase 未設定の topicContext を渡す（従来どおり動作）', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'stakeholders', phaseStatus: 'running' });
		mockRunStakeholderGeneration.mockResolvedValueOnce({
			ok: true,
			value: { stakeholders: ['s1'] }
		});

		await handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }));

		const [, topicContext] = mockRunStakeholderGeneration.mock.calls[0];
		expect(topicContext.factBase).toBeUndefined();
	});

	it('phaseStatus が not_started なら generated を上書きしない（未開始ガード）', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, {
			phase: 'stakeholders',
			phaseStatus: 'not_started'
		});
		mockRunStakeholderGeneration.mockResolvedValueOnce({
			ok: true,
			value: { stakeholders: ['s1'] }
		});

		await handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }));

		expect(stakeholders()).toEqual({ stakeholders: ['s1'] });
		expect(topic()?.phaseStatus).toBe('not_started');
	});

	it('生成エラー時はHttpsError(internal)を投げる', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'stakeholders', phaseStatus: 'running' });
		mockRunStakeholderGeneration.mockResolvedValueOnce({
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'AI failed', retryable: true }
		});
		await expect(handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }))).rejects.toMatchObject({
			code: 'internal'
		});
	});
});
