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

vi.mock('nanoid', () => ({ nanoid: () => 'newrun' }));

import { generateChapters } from '../../api/chapters.js';

const TOPIC_ID = 'topic1';
const makeRequest = (data: unknown) => ({ data, auth: { uid: 'user1' } });
const handler = generateChapters as unknown as (req: unknown) => Promise<unknown>;
const topic = () => holder.mock!.store.get(`topics/${TOPIC_ID}`);

beforeEach(() => {
	vi.clearAllMocks();
	holder.mock = createFirestoreMock();
});

describe('generateChapters handler（サーバ権威の再生成）', () => {
	it('topicIdがない場合はinvalid-argumentエラーを投げる', async () => {
		await expect(handler(makeRequest({}))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('topic が存在しない場合は not-found エラーを投げる', async () => {
		await expect(handler(makeRequest({ topicId: TOPIC_ID }))).rejects.toMatchObject({
			code: 'not-found'
		});
	});

	it('手順1: 呼び出し時に chapters/running＋新 runId に確定し、成功後 generated を確定して { topicId } を返す', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'chapters', phaseStatus: 'not_started' });
		mockPlanChapters.mockResolvedValueOnce(undefined);

		const result = await handler(makeRequest({ topicId: TOPIC_ID }));

		expect(mockPlanChapters).toHaveBeenCalledWith(TOPIC_ID);
		expect(result).toEqual({ topicId: TOPIC_ID });
		expect(topic()).toMatchObject({ phase: 'chapters', phaseStatus: 'generated', runId: 'newrun' });
	});

	it('approved 起点（editing）から再生成しても chapters/generated へ移り、旧章立て・付随分析＋下流を破棄する', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, {
			phase: 'editing',
			phaseStatus: 'approved',
			runId: 'old'
		});
		holder.mock!.store.set(`topics/${TOPIC_ID}/chapters/c1`, { chapterIndex: 0, turns: [] });
		holder.mock!.store.set(`topics/${TOPIC_ID}/chapterAnalysis/0`, { issues: [] });
		holder.mock!.store.set(`topics/${TOPIC_ID}/editedChapters/c1`, {
			chapterIndex: 0,
			status: 'completed'
		});
		holder.mock!.store.set(`topics/${TOPIC_ID}/editorial/0`, {
			intro: { status: 'finished', draft: 'x', final: 'y' },
			outro: { status: 'pending', draft: null, final: null },
			impressions: {}
		});
		mockPlanChapters.mockResolvedValueOnce(undefined);

		await handler(makeRequest({ topicId: TOPIC_ID }));

		expect(topic()).toMatchObject({ phase: 'chapters', phaseStatus: 'generated' });
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/chapters/c1`)).toBe(false);
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/chapterAnalysis/0`)).toBe(false);
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/editedChapters/c1`)).toBe(false);
		expect(holder.mock!.store.get(`topics/${TOPIC_ID}/editorial/0`)).toEqual({
			intro: { status: 'pending', draft: null, final: null },
			outro: { status: 'pending', draft: null, final: null },
			impressions: {}
		});
	});

	it('手順1後の失敗（planChapters 失敗）は chapters/stopped に留め、下流 approved へ戻さない', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'editing', phaseStatus: 'approved' });
		mockPlanChapters.mockRejectedValueOnce(new Error('plan failed'));

		await expect(handler(makeRequest({ topicId: TOPIC_ID }))).rejects.toMatchObject({
			code: 'internal'
		});
		expect(topic()).toMatchObject({ phase: 'chapters', phaseStatus: 'stopped' });
	});

	// 破棄集合パリティ（R6.3）: 整理前のクライアント reset 群（chapters/debate/editing）と完全一致。
	// 自層（chapters/chapterAnalysis）＋下流（editing）のみ削除し、上流（stakeholders/personas/factBase）は残す。
	it('破棄パリティ: 章立て・付随分析＋下流のみ削除し、上流 stakeholders/personas/factBase は残す', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'editing', phaseStatus: 'approved' });
		// 上流（keep）
		holder.mock!.store.set(`topics/${TOPIC_ID}/factBase/0`, { facts: [] });
		holder.mock!.store.set(`topics/${TOPIC_ID}/stakeholders/0`, { stakeholders: [] });
		holder.mock!.store.set(`topics/${TOPIC_ID}/personas/p1`, { name: 'A' });
		// 自層（delete）
		holder.mock!.store.set(`topics/${TOPIC_ID}/chapters/c1`, { chapterIndex: 0, turns: [] });
		holder.mock!.store.set(`topics/${TOPIC_ID}/chapterAnalysis/0`, { issues: [] });
		// 下流（delete）
		holder.mock!.store.set(`topics/${TOPIC_ID}/editedChapters/c1`, { chapterIndex: 0 });
		holder.mock!.store.set(`topics/${TOPIC_ID}/editorial/0`, {
			intro: { status: 'finished', draft: 'x', final: 'y' },
			outro: { status: 'pending', draft: null, final: null },
			impressions: {}
		});
		mockPlanChapters.mockResolvedValueOnce(undefined);

		await handler(makeRequest({ topicId: TOPIC_ID }));

		// 消しすぎない: 上流は残る
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/factBase/0`)).toBe(true);
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/stakeholders/0`)).toBe(true);
		expect(holder.mock!.store.has(`topics/${TOPIC_ID}/personas/p1`)).toBe(true);
		// 消し残さない: 自層＋下流は消える
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
