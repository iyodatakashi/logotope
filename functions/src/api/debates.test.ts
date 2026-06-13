import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExecuteChapterTask, mockGenerateChaptersOnly, mockEnqueue } = vi.hoisted(() => ({
  mockExecuteChapterTask: vi.fn(),
  mockGenerateChaptersOnly: vi.fn(),
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
  updateTopicPhase: vi.fn(),
  updateDebateSessionStatus: vi.fn(),
  getDebateSessionByTopicId: vi.fn(),
  discardChapterProgress: vi.fn(),
  markSessionError: vi.fn(),
}));
vi.mock('../pipeline/debate-orchestrator.js', () => ({
  // コンストラクタとして new されるため、アロー関数ではなく function 式でモックする（vitest 4）
  DebateOrchestratorService: vi.fn(function (this: unknown) {
    return {
      executeChapterTask: mockExecuteChapterTask,
      generateChaptersOnly: mockGenerateChaptersOnly,
    };
  }),
}));
vi.mock('../utils/auth.js', () => ({ requireAuth: vi.fn() }));

import * as repo from '../db/repository.js';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { generateChapters, startDebate, restartDebate } from './debates.js';

type TaskHandler = (req: { data: { topicId: string; chapterIndex: number }; retryCount: number }) => Promise<void>;
type CallHandler = (req: { data: { topicId: string } }) => Promise<unknown>;

const runChapterHandler = (): TaskHandler =>
  vi.mocked(onTaskDispatched).mock.calls[0][1] as unknown as TaskHandler;

const topicStub = { id: 't1', title: 'T', status: 'x', createdAt: '', updatedAt: '' };

beforeEach(() => {
  mockExecuteChapterTask.mockReset();
  mockGenerateChaptersOnly.mockReset();
  mockEnqueue.mockReset();
  vi.mocked(repo.getTopicById).mockReset();
  vi.mocked(repo.createDebateSession).mockReset();
  vi.mocked(repo.updateTopicStatus).mockReset();
  vi.mocked(repo.updateTopicPhase).mockReset();
  vi.mocked(repo.updateDebateSessionStatus).mockReset();
  vi.mocked(repo.getDebateSessionByTopicId).mockReset();
  vi.mocked(repo.discardChapterProgress).mockReset();
  vi.mocked(repo.markSessionError).mockClear();
});

describe('generateChapters - task 2.2: client権威化', () => {
  it('セッション作成と章立て生成を行い、トピックの状態は書き込まない', async () => {
    vi.mocked(repo.getTopicById).mockResolvedValue(topicStub);

    await (generateChapters as unknown as CallHandler)({ data: { topicId: 't1' } });

    expect(vi.mocked(repo.createDebateSession)).toHaveBeenCalledWith('t1', 'chapters_ready');
    expect(mockGenerateChaptersOnly).toHaveBeenCalledWith('t1');
    expect(vi.mocked(repo.updateTopicStatus)).not.toHaveBeenCalled();
    expect(vi.mocked(repo.updateTopicPhase)).not.toHaveBeenCalled();
  });
});

describe('startDebate - task 2.2: フェーズ5実行中の確定', () => {
  it('セッションを debating、トピックを (5, running) にして第0章を投入する', async () => {
    vi.mocked(repo.getTopicById).mockResolvedValue(topicStub);

    await (startDebate as unknown as CallHandler)({ data: { topicId: 't1' } });

    expect(vi.mocked(repo.updateDebateSessionStatus)).toHaveBeenCalledWith('t1', 'debating');
    expect(vi.mocked(repo.updateTopicPhase)).toHaveBeenCalledWith('t1', 5, 'running');
    expect(vi.mocked(repo.updateTopicStatus)).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith({ topicId: 't1', chapterIndex: 0 }, expect.anything());
  });
});

describe('restartDebate - task 2.3: 章単位再開', () => {
  it('停止時の章の途中ターンを破棄し、(5, running) にして当該章を頭から投入する', async () => {
    vi.mocked(repo.getTopicById).mockResolvedValue(topicStub);
    vi.mocked(repo.getDebateSessionByTopicId).mockResolvedValue({
      id: 't1', topicId: 't1', status: 'cancelled', createdAt: '', currentChapterIndex: 2,
    });

    await (restartDebate as unknown as CallHandler)({ data: { topicId: 't1' } });

    expect(vi.mocked(repo.discardChapterProgress)).toHaveBeenCalledWith('t1', 2);
    expect(vi.mocked(repo.updateTopicPhase)).toHaveBeenCalledWith('t1', 5, 'running');
    expect(mockEnqueue).toHaveBeenCalledWith({ topicId: 't1', chapterIndex: 2 }, expect.anything());
  });

  it('currentChapterIndex 未設定なら第0章から再開する', async () => {
    vi.mocked(repo.getTopicById).mockResolvedValue(topicStub);
    vi.mocked(repo.getDebateSessionByTopicId).mockResolvedValue({
      id: 't1', topicId: 't1', status: 'cancelled', createdAt: '',
    });

    await (restartDebate as unknown as CallHandler)({ data: { topicId: 't1' } });

    expect(vi.mocked(repo.discardChapterProgress)).toHaveBeenCalledWith('t1', 0);
    expect(mockEnqueue).toHaveBeenCalledWith({ topicId: 't1', chapterIndex: 0 }, expect.anything());
  });
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
