/**
 * generateFactResearch onCall の統合テスト（Task 4）。
 * 事実基盤のサーバ永続化（topics/{id}/factBase/0）と、confirmPhaseGenerated による
 * running→generated 限定の冪等確定を、インメモリ Firestore 上で検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFirestoreMock } from '../helpers/firestore-mock.js';

const mockRunFactResearch = vi.hoisted(() => vi.fn());

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

vi.mock('../../agents/fact-research-agent.js', () => ({
	runFactResearch: mockRunFactResearch
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	Timestamp: {
		now: () => 'TS',
		fromDate: (d: Date) => ({ __ts: d.toISOString() })
	}
}));

import { generateFactResearch } from '../../api/fact-research.js';

const TOPIC_ID = 'topic1';
const TITLE = '2026年W杯の日本を振り返る';
const NOW = new Date('2026-07-03T00:00:00Z');
const makeRequest = (data: unknown) => ({ data, auth: { uid: 'user1' } });
const handler = generateFactResearch as unknown as (req: unknown) => Promise<unknown>;
const topic = () => holder.mock!.store.get(`topics/${TOPIC_ID}`);
const factBase = () => holder.mock!.store.get(`topics/${TOPIC_ID}/factBase/0`);

const okFactBase = (facts: unknown[]) => ({
	ok: true,
	value: { facts, generatedAt: NOW }
});

beforeEach(() => {
	vi.clearAllMocks();
	holder.mock = createFirestoreMock();
});

describe('generateFactResearch handler', () => {
	it('topicId がない場合は invalid-argument エラーを投げる', async () => {
		await expect(handler(makeRequest({ title: TITLE }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('title がない場合は invalid-argument エラーを投げる', async () => {
		await expect(handler(makeRequest({ topicId: TOPIC_ID }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('生成成功時に事実基盤を factBase/0 に出典・生成基準日付きで永続し、generated を確定する', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, {
			phase: 'fact-research',
			phaseStatus: 'running'
		});
		mockRunFactResearch.mockResolvedValueOnce(
			okFactBase([
				{ statement: '日本は1回戦で敗退した', sources: [{ title: '報知', url: 'https://a' }] }
			])
		);

		const result = await handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }));

		expect(result).toEqual({});
		expect(factBase()).toEqual({
			facts: [
				{ statement: '日本は1回戦で敗退した', sources: [{ title: '報知', url: 'https://a' }] }
			],
			generatedAt: { __ts: NOW.toISOString() }
		});
		expect(topic()?.phase).toBe('fact-research');
		expect(topic()?.phaseStatus).toBe('generated');
	});

	it('空の事実基盤（facts:[]）でも保存し generated を確定する（縮退・再実行同経路）', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, {
			phase: 'fact-research',
			phaseStatus: 'running'
		});
		mockRunFactResearch.mockResolvedValueOnce(okFactBase([]));

		await handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }));

		expect(factBase()?.facts).toEqual([]);
		expect(topic()?.phaseStatus).toBe('generated');
	});

	it('再実行時は承認前の事実基盤を再生成（上書き保存）する', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, {
			phase: 'fact-research',
			phaseStatus: 'running'
		});
		holder.mock!.store.set(`topics/${TOPIC_ID}/factBase/0`, {
			facts: [{ statement: '古い事実', sources: [] }],
			generatedAt: { __ts: 'old' }
		});
		mockRunFactResearch.mockResolvedValueOnce(
			okFactBase([{ statement: '新しい事実', sources: [] }])
		);

		await handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }));

		expect(factBase()?.facts).toEqual([{ statement: '新しい事実', sources: [] }]);
	});

	it('phaseStatus が not_started なら generated を上書きしない（未開始ガード）', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, {
			phase: 'fact-research',
			phaseStatus: 'not_started'
		});
		mockRunFactResearch.mockResolvedValueOnce(okFactBase([]));

		await handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }));

		expect(factBase()?.facts).toEqual([]);
		expect(topic()?.phaseStatus).toBe('not_started');
	});

	it('生成が失敗（ok:false）なら HttpsError(internal) を投げる', async () => {
		mockRunFactResearch.mockResolvedValueOnce({
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'grounding failed', retryable: true }
		});

		await expect(handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }))).rejects.toMatchObject({
			code: 'internal'
		});
	});
});
