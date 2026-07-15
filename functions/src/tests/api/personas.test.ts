/**
 * startPersonaGeneration onCall の統合テスト（サーバ権威の再生成）。
 * 「phase 確定＋新 runId → 自層＋下流破棄 → 最初の段 enqueue」の順序と、approved 起点でのフラッシュ根絶・
 * 初回生成の no-op 破棄・手順1後失敗時の停止（下流非後退）を、インメモリ Firestore 上で検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFirestoreMock } from '../helpers/firestore-mock.js';

const { holder, mockEnqueuePersonaStep } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	},
	mockEnqueuePersonaStep: vi.fn()
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

vi.mock('firebase-functions/v2/tasks', () => ({
	onTaskDispatched: vi.fn((_opts: unknown, handler: unknown) => handler)
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	Timestamp: { now: () => 'TS' }
}));

vi.mock('nanoid', () => ({ nanoid: () => 'newrun' }));

vi.mock('../../utils/auth.js', () => ({ requireAuth: vi.fn() }));

vi.mock('../../pipeline/personas/enqueue-persona-step.js', () => ({
	enqueuePersonaStep: mockEnqueuePersonaStep
}));

vi.mock('../../pipeline/personas/persona-chain.js', () => ({
	advancePersonaChain: vi.fn()
}));

import { startPersonaGeneration } from '../../api/personas.js';

const TOPIC_ID = 'topic1';
const makeRequest = (data: unknown) => ({ data, auth: { uid: 'user1' } });
const handler = startPersonaGeneration as unknown as (req: unknown) => Promise<unknown>;
const topic = () => holder.mock!.store.get(`topics/${TOPIC_ID}`);

const seedDownstream = () => {
	holder.mock!.store.set(`topics/${TOPIC_ID}/stakeholders/0`, { stakeholders: [] });
	holder.mock!.store.set(`topics/${TOPIC_ID}/personas/p1`, { name: 'A' });
	holder.mock!.store.set(`topics/${TOPIC_ID}/chapters/c1`, { chapterIndex: 0, turns: [] });
	holder.mock!.store.set(`topics/${TOPIC_ID}/chapterAnalysis/0`, { issues: [] });
	holder.mock!.store.set(`topics/${TOPIC_ID}/editedChapters/c1`, { chapterIndex: 0, status: 'completed' });
	holder.mock!.store.set(`topics/${TOPIC_ID}/editorial/0`, {
		intro: { status: 'finished', draft: 'x', final: 'y' },
		outro: { status: 'pending', draft: null, final: null },
		impressions: {}
	});
};

beforeEach(() => {
	vi.clearAllMocks();
	holder.mock = createFirestoreMock();
	mockEnqueuePersonaStep.mockResolvedValue(undefined);
});

describe('startPersonaGeneration handler（サーバ権威の再生成）', () => {
	it('topicId がない場合は invalid-argument エラーを投げる', async () => {
		await expect(handler(makeRequest({}))).rejects.toMatchObject({ code: 'invalid-argument' });
	});

	it('topic が存在しない場合は not-found エラーを投げる', async () => {
		await expect(handler(makeRequest({ topicId: TOPIC_ID }))).rejects.toMatchObject({
			code: 'not-found'
		});
	});

	it('approved 起点（editing）から再生成すると personas/running＋新 runId に確定し、自層＋下流を破棄して最初の段を投入する', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, {
			phase: 'editing',
			phaseStatus: 'approved',
			runId: 'old'
		});
		seedDownstream();

		const result = await handler(makeRequest({ topicId: TOPIC_ID }));

		expect(result).toEqual({ topicId: TOPIC_ID });
		// 手順1: 対象フェーズ確定＋新世代
		expect(topic()).toMatchObject({ phase: 'personas', phaseStatus: 'running', runId: 'newrun' });
		// 手順2: 自層＋下流破棄
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/stakeholders/0`)).toBe(false);
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/personas/p1`)).toBe(false);
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/chapters/c1`)).toBe(false);
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/chapterAnalysis/0`)).toBe(false);
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/editedChapters/c1`)).toBe(false);
		expect(holder.mock!.store.get(`topics/${TOPIC_ID}/editorial/0`)).toEqual({
			intro: { status: 'pending', draft: null, final: null },
			outro: { status: 'pending', draft: null, final: null },
			impressions: {}
		});
		// 手順3: 最初の段を新 runId で投入
		expect(mockEnqueuePersonaStep).toHaveBeenCalledWith({
			topicId: TOPIC_ID,
			runId: 'newrun',
			stepKind: 'stakeholders'
		});
	});

	it('初回生成では下流破棄が no-op で同一経路を通り、running＋投入に到達する', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'personas', phaseStatus: 'not_started' });

		await handler(makeRequest({ topicId: TOPIC_ID }));

		expect(topic()).toMatchObject({ phase: 'personas', phaseStatus: 'running', runId: 'newrun' });
		expect(mockEnqueuePersonaStep).toHaveBeenCalledTimes(1);
	});

	it('手順1後の失敗（投入エラー）は personas/stopped に留め、下流 approved へ戻さない', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'editing', phaseStatus: 'approved' });
		mockEnqueuePersonaStep.mockRejectedValueOnce(new Error('enqueue failed'));

		await expect(handler(makeRequest({ topicId: TOPIC_ID }))).rejects.toMatchObject({
			code: 'internal'
		});
		expect(topic()).toMatchObject({ phase: 'personas', phaseStatus: 'stopped' });
	});

	// 破棄集合パリティ（R6.3）: 整理前のクライアント reset 群（stakeholders/personas/chapters/debate/editing）と
	// 完全一致。自層＋下流のみ削除し、上流（factBase）は残す（消し残し・消しすぎがない）。
	it('破棄パリティ: 自層＋下流のみ削除し、上流 factBase は残す', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'editing', phaseStatus: 'approved' });
		// 上流（keep）
		holder.mock!.store.set(`topics/${TOPIC_ID}/factBase/0`, { facts: [{ statement: 'x', sources: [] }] });
		// 自層（delete）
		holder.mock!.store.set(`topics/${TOPIC_ID}/stakeholders/0`, { stakeholders: [] });
		holder.mock!.store.set(`topics/${TOPIC_ID}/personas/p1`, { name: 'A' });
		// 下流（delete）
		holder.mock!.store.set(`topics/${TOPIC_ID}/chapters/c1`, { chapterIndex: 0, turns: [] });
		holder.mock!.store.set(`topics/${TOPIC_ID}/chapterAnalysis/0`, { issues: [] });
		holder.mock!.store.set(`topics/${TOPIC_ID}/editedChapters/c1`, { chapterIndex: 0 });
		holder.mock!.store.set(`topics/${TOPIC_ID}/editorial/0`, {
			intro: { status: 'finished', draft: 'x', final: 'y' },
			outro: { status: 'pending', draft: null, final: null },
			impressions: {}
		});

		await handler(makeRequest({ topicId: TOPIC_ID }));

		// 消しすぎない: 上流は残る
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/factBase/0`)).toBe(true);
		// 消し残さない: 自層＋下流は消える
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/stakeholders/0`)).toBe(false);
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/personas/p1`)).toBe(false);
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/chapters/c1`)).toBe(false);
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/chapterAnalysis/0`)).toBe(false);
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/editedChapters/c1`)).toBe(false);
		expect(holder.mock!.store.get(`topics/${TOPIC_ID}/editorial/0`)).toEqual({
			intro: { status: 'pending', draft: null, final: null },
			outro: { status: 'pending', draft: null, final: null },
			impressions: {}
		});
	});
});
