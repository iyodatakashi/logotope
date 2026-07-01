import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetTopicById, mockGetChapters } = vi.hoisted(() => ({
	mockGetTopicById: vi.fn(),
	mockGetChapters: vi.fn()
}));

const { mockStartRun, mockResetRun, mockStopRun, mockAdvance, mockEnqueue } = vi.hoisted(() => ({
	mockStartRun: vi.fn(),
	mockResetRun: vi.fn().mockResolvedValue(undefined),
	mockStopRun: vi.fn().mockResolvedValue(undefined),
	mockAdvance: vi.fn().mockResolvedValue(undefined),
	mockEnqueue: vi.fn().mockResolvedValue(undefined)
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
vi.mock('../../pipeline/debate/chapter.js', () => ({ getChaptersByTopicId: mockGetChapters }));
vi.mock('../../pipeline/editing/editing-orchestrator.js', () => ({ advanceEditing: mockAdvance }));
vi.mock('../../pipeline/editing/enqueue-editing-step.js', () => ({
	enqueueEditingStep: mockEnqueue
}));
vi.mock('../../pipeline/editing/editing-lifecycle.js', () => ({
	startEditingRun: mockStartRun,
	resetEditingRun: mockResetRun,
	stopEditingRun: mockStopRun
}));

import { startEditing, resetEditing, runEditingStep } from '../../api/editing.js';
import { requireAuth } from '../../utils/auth.js';

const startHandler = startEditing as unknown as (req: unknown) => Promise<unknown>;
const resetHandler = resetEditing as unknown as (req: unknown) => Promise<unknown>;
const taskHandler = runEditingStep as unknown as (req: unknown) => Promise<unknown>;
const makeRequest = (data: unknown) => ({ data, auth: { uid: 'user1' } });

beforeEach(() => {
	vi.clearAllMocks();
	mockStartRun.mockResolvedValue('run-1');
	mockGetTopicById.mockResolvedValue({ id: 't1', title: 'テーマ' });
	mockGetChapters.mockResolvedValue([{ id: 'c1', chapterIndex: 0 }]);
});

describe('startEditing onCall', () => {
	it('topicId がなければ invalid-argument', async () => {
		await expect(startHandler(makeRequest({}))).rejects.toMatchObject({ code: 'invalid-argument' });
	});

	it('認証チェックを行う', async () => {
		await startHandler(makeRequest({ topicId: 't1' }));
		expect(requireAuth).toHaveBeenCalled();
	});

	it('トピックが無ければ not-found を投げ、開始もタスク投入もしない', async () => {
		mockGetTopicById.mockResolvedValueOnce(null);
		await expect(startHandler(makeRequest({ topicId: 't1' }))).rejects.toMatchObject({
			code: 'not-found'
		});
		expect(mockStartRun).not.toHaveBeenCalled();
		expect(mockEnqueue).not.toHaveBeenCalled();
	});

	it('章が無ければ not-found を投げ、開始もタスク投入もしない', async () => {
		mockGetChapters.mockResolvedValueOnce([]);
		await expect(startHandler(makeRequest({ topicId: 't1' }))).rejects.toMatchObject({
			code: 'not-found'
		});
		expect(mockStartRun).not.toHaveBeenCalled();
		expect(mockEnqueue).not.toHaveBeenCalled();
	});

	it('編集ランを開始し、最初の章ステップを投入して {topicId} を返す', async () => {
		const result = await startHandler(makeRequest({ topicId: 't1' }));
		expect(mockStartRun).toHaveBeenCalledWith('t1');
		expect(mockEnqueue).toHaveBeenCalledWith({
			topicId: 't1',
			runId: 'run-1',
			stepKind: 'chapter',
			chapterIndex: 0
		});
		// onCall 内で編集本体（advanceEditing）は実行しない
		expect(mockAdvance).not.toHaveBeenCalled();
		expect(result).toEqual({ topicId: 't1' });
	});
});

describe('resetEditing onCall', () => {
	it('topicId がなければ invalid-argument', async () => {
		await expect(resetHandler(makeRequest({}))).rejects.toMatchObject({ code: 'invalid-argument' });
	});

	it('トピックが無ければ not-found を投げ、リセットしない', async () => {
		mockGetTopicById.mockResolvedValueOnce(null);
		await expect(resetHandler(makeRequest({ topicId: 't1' }))).rejects.toMatchObject({
			code: 'not-found'
		});
		expect(mockResetRun).not.toHaveBeenCalled();
	});

	it('編集を未実行状態へ戻して {topicId} を返す', async () => {
		const result = await resetHandler(makeRequest({ topicId: 't1' }));
		expect(mockResetRun).toHaveBeenCalledWith('t1');
		expect(result).toEqual({ topicId: 't1' });
	});
});

describe('runEditingStep（タスク本体）', () => {
	const makeTaskReq = (retryCount = 0) => ({
		data: { topicId: 't1', runId: 'run-1', stepKind: 'chapter', chapterIndex: 0 },
		retryCount
	});

	it('advanceEditing にペイロードを渡して実行する', async () => {
		await taskHandler(makeTaskReq());
		expect(mockAdvance).toHaveBeenCalledWith({
			topicId: 't1',
			runId: 'run-1',
			stepKind: 'chapter',
			chapterIndex: 0
		});
	});

	it('例外時かつ最終試行でなければ停止せず throw（リトライさせる）', async () => {
		mockAdvance.mockRejectedValueOnce(new Error('transient'));
		await expect(taskHandler(makeTaskReq(0))).rejects.toThrow('transient');
		expect(mockStopRun).not.toHaveBeenCalled();
	});

	it('例外時かつ最終試行なら stopped にして throw', async () => {
		mockAdvance.mockRejectedValueOnce(new Error('fatal'));
		await expect(taskHandler(makeTaskReq(2))).rejects.toThrow('fatal');
		expect(mockStopRun).toHaveBeenCalledWith('t1', 'run-1');
	});
});
