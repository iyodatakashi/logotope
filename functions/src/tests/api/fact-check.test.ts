import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetChapterById, mockCheckChapter } = vi.hoisted(() => ({
	mockGetChapterById: vi.fn(),
	mockCheckChapter: vi.fn()
}));

const { mockStart, mockAppend, mockReset, mockMarkCompleted, mockFail } = vi.hoisted(() => ({
	mockStart: vi.fn().mockResolvedValue(undefined),
	mockAppend: vi.fn().mockResolvedValue(undefined),
	mockReset: vi.fn().mockResolvedValue(undefined),
	mockMarkCompleted: vi.fn().mockResolvedValue(undefined),
	mockFail: vi.fn().mockResolvedValue(undefined)
}));

const { mockEnqueue } = vi.hoisted(() => ({ mockEnqueue: vi.fn().mockResolvedValue(undefined) }));

vi.mock('firebase-functions/v2/https', () => ({
	onCall: vi.fn((handler: unknown) => handler),
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

vi.mock('firebase-admin/functions', () => ({
	getFunctions: () => ({ taskQueue: () => ({ enqueue: mockEnqueue }) })
}));

vi.mock('../../utils/auth.js', () => ({ requireAuth: vi.fn() }));

vi.mock('../../pipeline/debate/chapter.js', () => ({ getChapterById: mockGetChapterById }));

vi.mock('../../pipeline/fact-check/fact-check-runner.js', () => ({
	checkChapter: mockCheckChapter
}));

vi.mock('../../pipeline/fact-check/fact-check-repository.js', () => ({
	startFactCheckResult: mockStart,
	appendFactCheckFindings: mockAppend,
	resetFactCheckProgress: mockReset,
	markFactCheckCompleted: mockMarkCompleted,
	failFactCheckResult: mockFail
}));

import { runFactCheck, runFactCheckTask } from '../../api/fact-check.js';
import { requireAuth } from '../../utils/auth.js';

const callHandler = runFactCheck as unknown as (req: unknown) => Promise<unknown>;
const taskHandler = runFactCheckTask as unknown as (req: unknown) => Promise<unknown>;
const makeRequest = (data: unknown) => ({ data, auth: { uid: 'user1' } });

const completedChapter = {
	id: 'c1',
	chapterIndex: 0,
	title: 't',
	focusQuestion: 'f',
	discussionPoints: [],
	turns: [],
	status: 'completed' as const
};

const makeFinding = (id: string, url: string) => ({
	id,
	turnId: 'turn1',
	speakerType: 'persona' as const,
	claim: 'c',
	verdict: 'incorrect' as const,
	correction: 'x',
	reason: 'r',
	sources: [{ title: url, url }]
});

beforeEach(() => {
	vi.clearAllMocks();
});

describe('runFactCheck onCall（前提検証＋タスク投入）', () => {
	it('topicId がなければ invalid-argument', async () => {
		await expect(callHandler(makeRequest({ chapterId: 'c1' }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('chapterId がなければ invalid-argument', async () => {
		await expect(callHandler(makeRequest({ topicId: 't1' }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('認証チェックを行う', async () => {
		mockGetChapterById.mockResolvedValueOnce(completedChapter);
		await callHandler(makeRequest({ topicId: 't1', chapterId: 'c1' }));
		expect(requireAuth).toHaveBeenCalled();
	});

	it('章が存在しなければ not-found を投げ、running もタスク投入もしない', async () => {
		mockGetChapterById.mockResolvedValueOnce(null);
		await expect(
			callHandler(makeRequest({ topicId: 't1', chapterId: 'c1' }))
		).rejects.toMatchObject({ code: 'not-found' });
		expect(mockStart).not.toHaveBeenCalled();
		expect(mockEnqueue).not.toHaveBeenCalled();
	});

	it('章が未完了なら failed-precondition を投げ、running もタスク投入もしない', async () => {
		mockGetChapterById.mockResolvedValueOnce({ ...completedChapter, status: 'running' });
		await expect(
			callHandler(makeRequest({ topicId: 't1', chapterId: 'c1' }))
		).rejects.toMatchObject({ code: 'failed-precondition' });
		expect(mockStart).not.toHaveBeenCalled();
		expect(mockEnqueue).not.toHaveBeenCalled();
	});

	it('完了章では running を書き、タスクを投入して {topicId, chapterId} を即返す', async () => {
		mockGetChapterById.mockResolvedValueOnce(completedChapter);
		const result = await callHandler(makeRequest({ topicId: 't1', chapterId: 'c1' }));
		expect(mockStart).toHaveBeenCalledWith('t1', 'c1');
		expect(mockEnqueue).toHaveBeenCalledWith({ topicId: 't1', chapterId: 'c1' });
		// onCall 内では検証本体（checkChapter）を実行しない
		expect(mockCheckChapter).not.toHaveBeenCalled();
		expect(result).toEqual({ topicId: 't1', chapterId: 'c1' });
	});
});

describe('runFactCheckTask（検証本体）', () => {
	const makeTaskReq = (retryCount = 0) => ({
		data: { topicId: 't1', chapterId: 'c1' },
		retryCount
	});

	it('発言ごとに追記し、完了で completed にする', async () => {
		const findings = [makeFinding('f1', 'https://a.com')];
		mockCheckChapter.mockImplementationOnce(async (_input, onTurn) => {
			await onTurn(findings);
			return { ok: true, value: findings };
		});
		await taskHandler(makeTaskReq());
		expect(mockAppend).toHaveBeenCalledWith('t1', 'c1', findings, [
			{ title: 'https://a.com', url: 'https://a.com' }
		]);
		expect(mockMarkCompleted).toHaveBeenCalledWith('t1', 'c1');
	});

	it('発言ごとの追記で出典を重複排除して渡す', async () => {
		const turnFindings = [makeFinding('f1', 'https://a.com'), makeFinding('f2', 'https://a.com')];
		mockCheckChapter.mockImplementationOnce(async (_input, onTurn) => {
			await onTurn(turnFindings);
			return { ok: true, value: turnFindings };
		});
		await taskHandler(makeTaskReq());
		expect(mockAppend.mock.calls[0][3]).toEqual([{ title: 'https://a.com', url: 'https://a.com' }]);
	});

	it('初回（retryCount=0）は追記前のクリアをしない', async () => {
		mockCheckChapter.mockImplementationOnce(async () => ({ ok: true, value: [] }));
		await taskHandler(makeTaskReq(0));
		expect(mockReset).not.toHaveBeenCalled();
	});

	it('再試行（retryCount>0）は検証前に部分追記をクリアして重複を防ぐ', async () => {
		mockCheckChapter.mockImplementationOnce(async () => ({ ok: true, value: [] }));
		await taskHandler(makeTaskReq(1));
		expect(mockReset).toHaveBeenCalledWith('t1', 'c1');
	});

	it('checkChapter がエラー結果なら failed を記録し、リトライしない（throw しない）', async () => {
		mockCheckChapter.mockResolvedValueOnce({
			ok: false,
			error: { code: 'NOT_FOUND', resource: 'chapter' }
		});
		await expect(taskHandler(makeTaskReq())).resolves.toBeUndefined();
		expect(mockFail).toHaveBeenCalledWith('t1', 'c1', 'NOT_FOUND');
		expect(mockMarkCompleted).not.toHaveBeenCalled();
	});

	it('例外時かつ最終試行でなければ failed を書かず throw（リトライさせる）', async () => {
		mockCheckChapter.mockRejectedValueOnce(new Error('transient'));
		await expect(taskHandler(makeTaskReq(0))).rejects.toThrow('transient');
		expect(mockFail).not.toHaveBeenCalled();
	});

	it('例外時かつ最終試行なら failed を記録して throw', async () => {
		mockCheckChapter.mockRejectedValueOnce(new Error('fatal'));
		await expect(taskHandler(makeTaskReq(2))).rejects.toThrow('fatal');
		expect(mockFail).toHaveBeenCalledWith('t1', 'c1', 'fatal');
	});
});
