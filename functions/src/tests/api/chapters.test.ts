/**
 * generateChapters onCall のユニットテスト（Task 3.1）。
 * 既存の章立て永続化（planChapters）の成功後に、共通ヘルパー confirmPhaseGenerated で
 * running→generated 限定の冪等確定を行うことを、インメモリ Firestore 上で検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFirestoreMock } from '../helpers/firestore-mock.js';

const mockPlanChapters = vi.hoisted(() => vi.fn());

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

vi.mock('../../pipeline/chapters/chapter-generator.js', () => ({
	planChapters: mockPlanChapters
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	Timestamp: { now: () => 'TS' }
}));

import { generateChapters } from '../../api/chapters.js';

const TOPIC_ID = 'topic1';
const makeRequest = (data: unknown) => ({ data, auth: { uid: 'user1' } });
const handler = generateChapters as unknown as (req: unknown) => Promise<unknown>;
const topic = () => holder.mock!.store.get(`topics/${TOPIC_ID}`);

beforeEach(() => {
	vi.clearAllMocks();
	holder.mock = createFirestoreMock();
});

describe('generateChapters handler', () => {
	it('topicIdがない場合はinvalid-argumentエラーを投げる', async () => {
		await expect(handler(makeRequest({}))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('章立て永続化の成功後に confirmPhaseGenerated で generated を確定し { topicId } を返す', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 4, phaseStatus: 'running' });
		mockPlanChapters.mockResolvedValueOnce(undefined);

		const result = await handler(makeRequest({ topicId: TOPIC_ID }));

		expect(mockPlanChapters).toHaveBeenCalledWith(TOPIC_ID);
		expect(result).toEqual({ topicId: TOPIC_ID });
		expect(topic()?.phase).toBe(4);
		expect(topic()?.phaseStatus).toBe('generated');
	});

	it('phaseStatus が not_started なら generated を上書きしない（未開始ガード）', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 4, phaseStatus: 'not_started' });
		mockPlanChapters.mockResolvedValueOnce(undefined);

		await handler(makeRequest({ topicId: TOPIC_ID }));

		expect(topic()?.phaseStatus).toBe('not_started');
	});

	it('planChapters が失敗したらHttpsError(internal)を投げ、generated を確定しない', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 4, phaseStatus: 'running' });
		mockPlanChapters.mockRejectedValueOnce(new Error('plan failed'));

		await expect(handler(makeRequest({ topicId: TOPIC_ID }))).rejects.toMatchObject({
			code: 'internal'
		});
		expect(topic()?.phaseStatus).toBe('running');
	});
});
