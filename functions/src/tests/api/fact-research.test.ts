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

describe('generateFactResearch handler（サーバ権威の再生成）', () => {
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

	it('手順1: 呼び出し時に fact-research を running に確定し、成功後 generated を確定する', async () => {
		// 起点が theme/approved でも onCall 自身が running を書く（クライアントの事前 setPhaseStatus に依存しない）
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'theme', phaseStatus: 'approved' });
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

	it('approved 起点（editing）から再生成しても fact-research/generated へ移り、全下流データを破棄する', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, {
			phase: 'editing',
			phaseStatus: 'approved',
			runId: 'old'
		});
		holder.mock!.store.set(`topics/${TOPIC_ID}/stakeholders/0`, { stakeholders: [] });
		holder.mock!.store.set(`topics/${TOPIC_ID}/personas/p1`, { name: 'A' });
		holder.mock!.store.set(`topics/${TOPIC_ID}/chapters/c1`, { chapterIndex: 0, turns: [] });
		holder.mock!.store.set(`topics/${TOPIC_ID}/chapterAnalysis/0`, { issues: [] });
		holder.mock!.store.set(`topics/${TOPIC_ID}/editedChapters/c1`, {
			chapterIndex: 0,
			status: 'completed'
		});
		holder.mock!.store.set(`topics/${TOPIC_ID}/editorial/outputs`, {
			intro: { status: 'finished', draft: 'x', final: 'y' },
			outro: { status: 'pending', draft: null, final: null },
			impressions: {}
		});
		mockRunFactResearch.mockResolvedValueOnce(okFactBase([]));

		await handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }));

		expect(topic()?.phase).toBe('fact-research');
		expect(topic()?.phaseStatus).toBe('generated');
		// 下流破棄（クライアント reset 群と同範囲）
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/stakeholders/0`)).toBe(false);
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/personas/p1`)).toBe(false);
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/chapters/c1`)).toBe(false);
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/chapterAnalysis/0`)).toBe(false);
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/editedChapters/c1`)).toBe(false);
		expect(holder.mock!.store.get(`topics/${TOPIC_ID}/editorial/outputs`)).toEqual({
			intro: { status: 'pending', draft: null, final: null },
			outro: { status: 'pending', draft: null, final: null },
			impressions: {}
		});
	});

	it('初回生成では下流破棄が no-op で同一経路を通り generated を確定する', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, {
			phase: 'fact-research',
			phaseStatus: 'not_started'
		});
		mockRunFactResearch.mockResolvedValueOnce(okFactBase([{ statement: '新', sources: [] }]));

		await handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }));

		expect(topic()?.phaseStatus).toBe('generated');
		expect(factBase()?.facts).toEqual([{ statement: '新', sources: [] }]);
	});

	it('再実行時は事実基盤を上書き再生成する', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, {
			phase: 'fact-research',
			phaseStatus: 'generated'
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

	it('手順1後の失敗（生成 ok:false）は fact-research/stopped に留め、下流 approved へ戻さない', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'editing', phaseStatus: 'approved' });
		mockRunFactResearch.mockResolvedValueOnce({
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'grounding failed', retryable: true }
		});

		await expect(handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }))).rejects.toMatchObject({
			code: 'internal'
		});
		expect(topic()?.phase).toBe('fact-research');
		expect(topic()?.phaseStatus).toBe('stopped');
	});
});
