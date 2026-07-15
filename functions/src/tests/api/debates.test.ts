/**
 * startDebate onCall の統合テスト（サーバ権威の再生成）。
 * 「debate を running に確定＋新 runId → 討論付随データ＋下流 editing 破棄 → 最初の open ステップ投入」の
 * 順序と、手順1後失敗時の停止（下流非後退）を検証する。破棄の実体（turns/engagements/editing）は
 * resetDebate lifecycle が担うため、ここでは onCall がその順序で所有することを固定する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
	mockGetTopicById,
	mockGetChaptersByTopicId,
	mockUpdateDebatePhaseStatus,
	mockResetDebate,
	mockRestartDebateFromChapter,
	mockEnqueueStep,
	calls
} = vi.hoisted(() => ({
	mockGetTopicById: vi.fn(),
	mockGetChaptersByTopicId: vi.fn(),
	mockUpdateDebatePhaseStatus: vi.fn(),
	mockResetDebate: vi.fn(),
	mockRestartDebateFromChapter: vi.fn(),
	mockEnqueueStep: vi.fn(),
	calls: [] as string[]
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

vi.mock('../../utils/auth.js', () => ({ requireAuth: vi.fn() }));

vi.mock('../../pipeline/topics/topics.js', () => ({ getTopicById: mockGetTopicById }));

vi.mock('../../pipeline/debate/chapter.js', () => ({
	getChaptersByTopicId: mockGetChaptersByTopicId
}));

vi.mock('../../pipeline/debate/debate-lifecycle.js', () => ({
	beginDebateRun: mockUpdateDebatePhaseStatus,
	restartDebateFromChapter: mockRestartDebateFromChapter,
	resetDebate: mockResetDebate
}));

vi.mock('../../pipeline/debate/enqueue-step.js', () => ({
	enqueueStep: mockEnqueueStep,
	taskKey: vi.fn(() => 'task-key')
}));

vi.mock('../../pipeline/debate/debate-orchestrator.js', () => ({ advanceDebate: vi.fn() }));

import { startDebate } from '../../api/debates.js';

const TOPIC_ID = 'topic1';
const makeRequest = (data: unknown) => ({ data, auth: { uid: 'user1' } });
const handler = startDebate as unknown as (req: unknown) => Promise<unknown>;

beforeEach(() => {
	vi.clearAllMocks();
	calls.length = 0;
	mockGetTopicById.mockResolvedValue({ id: TOPIC_ID });
	mockGetChaptersByTopicId.mockResolvedValue([
		{ id: 'c1', chapterIndex: 0, status: 'pending' }
	]);
	mockUpdateDebatePhaseStatus.mockImplementation(async (_t: string, status: string) => {
		calls.push(`phase:${status}`);
		return 'newrun';
	});
	mockResetDebate.mockImplementation(async () => {
		calls.push('reset');
	});
	mockEnqueueStep.mockImplementation(async () => {
		calls.push('enqueue');
	});
});

describe('startDebate handler（サーバ権威の再生成）', () => {
	it('topic が存在しない場合は not-found（phase 確定しない）', async () => {
		mockGetTopicById.mockResolvedValueOnce(null);
		await expect(handler(makeRequest({ topicId: TOPIC_ID }))).rejects.toMatchObject({
			code: 'not-found'
		});
		expect(mockUpdateDebatePhaseStatus).not.toHaveBeenCalled();
	});

	it('章が無い場合は not-found（phase 確定しない）', async () => {
		mockGetChaptersByTopicId.mockResolvedValueOnce([]);
		await expect(handler(makeRequest({ topicId: TOPIC_ID }))).rejects.toMatchObject({
			code: 'not-found'
		});
		expect(mockUpdateDebatePhaseStatus).not.toHaveBeenCalled();
	});

	it('「phase running 確定＋新 runId → 破棄 → 投入」の順序で所有する', async () => {
		const result = await handler(makeRequest({ topicId: TOPIC_ID }));

		expect(result).toEqual({ topicId: TOPIC_ID });
		expect(calls).toEqual(['phase:running', 'reset', 'enqueue']);
		// 手順3 の投入は手順1 の新 runId に紐づく
		expect(mockEnqueueStep).toHaveBeenCalledWith(
			expect.objectContaining({ topicId: TOPIC_ID, runId: 'newrun', stepKind: 'open' }),
			'task-key'
		);
		// 成功時は stopped を書かない
		expect(calls).not.toContain('phase:stopped');
	});

	it('手順1後の失敗（破棄エラー）は debate/stopped に留め、下流 approved へ戻さない', async () => {
		mockResetDebate.mockImplementationOnce(async () => {
			calls.push('reset');
			throw new Error('discard failed');
		});

		await expect(handler(makeRequest({ topicId: TOPIC_ID }))).rejects.toMatchObject({
			code: 'internal'
		});
		expect(calls).toEqual(['phase:running', 'reset', 'phase:stopped']);
		expect(mockEnqueueStep).not.toHaveBeenCalled();
	});
});
