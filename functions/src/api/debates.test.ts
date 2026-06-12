import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExecuteChapterTask, mockEnqueue } = vi.hoisted(() => ({
  mockExecuteChapterTask: vi.fn(),
  mockEnqueue: vi.fn(),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((_opts: unknown, handler: unknown) => handler),
  HttpsError: class HttpsError extends Error {},
}));
vi.mock('firebase-functions/v2/tasks', () => ({
  onTaskDispatched: vi.fn((_opts: unknown, handler: unknown) => handler),
}));
vi.mock('firebase-admin/functions', () => ({
  getFunctions: vi.fn(() => ({
    taskQueue: vi.fn(() => ({ enqueue: mockEnqueue })),
  })),
}));
vi.mock('../db/repository.js', () => ({
  getTopicById: vi.fn(),
  createDebateSession: vi.fn(),
  updateTopicStatus: vi.fn(),
  markSessionError: vi.fn(),
}));
vi.mock('../pipeline/debate-orchestrator.js', () => ({
  // コンストラクタとして new されるため、アロー関数ではなく function 式でモックする（vitest 4）
  DebateOrchestratorService: vi.fn(function (this: unknown) {
    return { executeChapterTask: mockExecuteChapterTask };
  }),
}));
vi.mock('../utils/auth.js', () => ({ requireAuth: vi.fn() }));

import * as repo from '../db/repository.js';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import './debates.js';

type TaskHandler = (req: { data: { topicId: string; chapterIndex: number }; retryCount: number }) => Promise<void>;

const runChapterHandler = (): TaskHandler =>
  vi.mocked(onTaskDispatched).mock.calls[0][1] as unknown as TaskHandler;

beforeEach(() => {
  mockExecuteChapterTask.mockReset();
  mockEnqueue.mockReset();
  vi.mocked(repo.markSessionError).mockClear();
});

describe('runChapter - task 4.4: エラー終端', () => {
  it('成功時（次章あり）は次章タスクを投入し、markSessionError を呼ばない', async () => {
    mockExecuteChapterTask.mockResolvedValue(true);

    await runChapterHandler()({ data: { topicId: 't1', chapterIndex: 0 }, retryCount: 0 });

    expect(mockEnqueue).toHaveBeenCalledWith({ topicId: 't1', chapterIndex: 1 }, expect.anything());
    expect(vi.mocked(repo.markSessionError)).not.toHaveBeenCalled();
  });

  it('成功時（次章なし）は次章タスクを投入しない', async () => {
    mockExecuteChapterTask.mockResolvedValue(false);

    await runChapterHandler()({ data: { topicId: 't1', chapterIndex: 1 }, retryCount: 0 });

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('失敗時、最終リトライ前（retryCount < 2）は status を変えずに再スローする', async () => {
    mockExecuteChapterTask.mockRejectedValue(new Error('chapter failed'));

    await expect(
      runChapterHandler()({ data: { topicId: 't1', chapterIndex: 0 }, retryCount: 1 })
    ).rejects.toThrow('chapter failed');

    expect(vi.mocked(repo.markSessionError)).not.toHaveBeenCalled();
  });

  it('最終リトライ（retryCount = 2）でも失敗した場合はセッションを error にして再スローする', async () => {
    mockExecuteChapterTask.mockRejectedValue(new Error('chapter failed'));

    await expect(
      runChapterHandler()({ data: { topicId: 't1', chapterIndex: 0 }, retryCount: 2 })
    ).rejects.toThrow('chapter failed');

    expect(vi.mocked(repo.markSessionError)).toHaveBeenCalledWith('t1');
  });
});
