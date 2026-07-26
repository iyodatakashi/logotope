import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetTopicById, mockGetChapters, mockIsDebateCompleted, mockDocGet } = vi.hoisted(() => ({
	mockGetTopicById: vi.fn(),
	mockGetChapters: vi.fn(),
	mockIsDebateCompleted: vi.fn(),
	mockDocGet: vi.fn()
}));

const { mockStartRun, mockStopRun, mockAdvance, mockEnqueue } = vi.hoisted(() => ({
	mockStartRun: vi.fn(),
	mockStopRun: vi.fn().mockResolvedValue(undefined),
	mockAdvance: vi.fn().mockResolvedValue(undefined),
	mockEnqueue: vi.fn().mockResolvedValue(undefined)
}));

const { mockRegenChapter, mockRegenIntro, mockRegenOutro, mockRegenImpression } = vi.hoisted(() => ({
	mockRegenChapter: vi.fn().mockResolvedValue(undefined),
	mockRegenIntro: vi.fn().mockResolvedValue(undefined),
	mockRegenOutro: vi.fn().mockResolvedValue(undefined),
	mockRegenImpression: vi.fn().mockResolvedValue(undefined)
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
	getFirestore: () => ({ doc: () => ({ get: mockDocGet }) })
}));

vi.mock('../../utils/auth.js', () => ({ requireAuth: vi.fn() }));
vi.mock('../../pipeline/topics/topics.js', () => ({ getTopicById: mockGetTopicById }));
vi.mock('../../pipeline/debate/chapter.js', () => ({ getChaptersByTopicId: mockGetChapters }));
vi.mock('../../pipeline/editing/editing-orchestrator.js', () => ({ advanceEditing: mockAdvance }));
vi.mock('../../pipeline/editing/enqueue-editing-step.js', () => ({ enqueueEditingStep: mockEnqueue }));
vi.mock('../../pipeline/editing/editing-lifecycle.js', () => ({
	startEditingRun: mockStartRun,
	stopEditingRun: mockStopRun
}));
vi.mock('../../pipeline/editing/regenerate-article-element.js', () => ({
	regenerateChapter: mockRegenChapter,
	regenerateIntro: mockRegenIntro,
	regenerateOutro: mockRegenOutro,
	regenerateImpression: mockRegenImpression
}));
vi.mock('../../pipeline/debate/debate-lifecycle.js', () => ({
	isDebateCompleted: mockIsDebateCompleted
}));

import { startEditing, runEditingStep, regenerateArticleElement } from '../../api/editing.js';
import { requireAuth } from '../../utils/auth.js';

const startHandler = startEditing as unknown as (req: unknown) => Promise<unknown>;
const taskHandler = runEditingStep as unknown as (req: unknown) => Promise<unknown>;
const regenHandler = regenerateArticleElement as unknown as (req: unknown) => Promise<unknown>;
const makeRequest = (data: unknown) => ({ data, auth: { uid: 'user1' } });

const settledTopic = () => ({ exists: true, data: () => ({ phase: 'editing', phaseStatus: 'stopped' }) });

beforeEach(() => {
	vi.clearAllMocks();
	mockStartRun.mockResolvedValue('run-1');
	mockGetTopicById.mockResolvedValue({ id: 't1', title: 'テーマ' });
	mockGetChapters.mockResolvedValue([{ id: 'c1', chapterIndex: 0 }]);
	mockIsDebateCompleted.mockResolvedValue(true);
	mockDocGet.mockResolvedValue(settledTopic());
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

	it('討論が未完了なら failed-precondition を投げ、開始もタスク投入もしない', async () => {
		mockIsDebateCompleted.mockResolvedValueOnce(false);
		await expect(startHandler(makeRequest({ topicId: 't1' }))).rejects.toMatchObject({
			code: 'failed-precondition'
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

	it('編集ランを開始し、最初に impressions ステージを投入して {topicId} を返す', async () => {
		const result = await startHandler(makeRequest({ topicId: 't1' }));
		expect(mockStartRun).toHaveBeenCalledWith('t1');
		expect(mockEnqueue).toHaveBeenCalledWith({
			topicId: 't1',
			runId: 'run-1',
			stepKind: 'impressions',
			chapterIndex: -1
		});
		expect(mockAdvance).not.toHaveBeenCalled();
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

	it('impressions ステージの終端失敗も編集を stopped にする（討論 generated は phase=editing のまま保持）', async () => {
		mockAdvance.mockRejectedValueOnce(new Error('generation failed'));
		const req = {
			data: { topicId: 't1', runId: 'run-1', stepKind: 'impressions', chapterIndex: -1 },
			retryCount: 2
		};
		await expect(taskHandler(req)).rejects.toThrow('generation failed');
		expect(mockStopRun).toHaveBeenCalledWith('t1', 'run-1');
	});
});

describe('regenerateArticleElement onCall（個別再生成の共通入口）', () => {
	it('topicId / element が無ければ invalid-argument', async () => {
		await expect(regenHandler(makeRequest({ topicId: 't1' }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('トピックが無ければ not-found', async () => {
		mockDocGet.mockResolvedValueOnce({ exists: false, data: () => undefined });
		await expect(
			regenHandler(makeRequest({ topicId: 't1', articleElement: { kind: 'intro' } }))
		).rejects.toMatchObject({ code: 'not-found' });
	});

	it('編集実行中（phase=editing・running）は failed-precondition で拒否し、コアを呼ばない（Req 4.7）', async () => {
		mockDocGet.mockResolvedValueOnce({
			exists: true,
			data: () => ({ phase: 'editing', phaseStatus: 'running' })
		});
		await expect(
			regenHandler(makeRequest({ topicId: 't1', articleElement: { kind: 'intro' } }))
		).rejects.toMatchObject({ code: 'failed-precondition' });
		expect(mockRegenIntro).not.toHaveBeenCalled();
	});

	it('chapter 種別を regenerateChapter へ振り分け {topicId} を返す', async () => {
		const result = await regenHandler(
			makeRequest({ topicId: 't1', articleElement: { kind: 'chapter', chapterId: 'c1' } })
		);
		expect(mockRegenChapter).toHaveBeenCalledWith('t1', 'c1');
		expect(result).toEqual({ topicId: 't1' });
	});

	it('intro / outro 種別を各コアへ振り分ける', async () => {
		await regenHandler(makeRequest({ topicId: 't1', articleElement: { kind: 'intro' } }));
		expect(mockRegenIntro).toHaveBeenCalledWith('t1');
		await regenHandler(makeRequest({ topicId: 't1', articleElement: { kind: 'outro' } }));
		expect(mockRegenOutro).toHaveBeenCalledWith('t1');
	});

	it('impression 種別を personaId 付きで regenerateImpression へ振り分ける', async () => {
		await regenHandler(
			makeRequest({ topicId: 't1', articleElement: { kind: 'impression', personaId: 'p2' } })
		);
		expect(mockRegenImpression).toHaveBeenCalledWith('t1', 'p2');
	});

	it('chapter で chapterId が無ければ invalid-argument', async () => {
		await expect(
			regenHandler(makeRequest({ topicId: 't1', articleElement: { kind: 'chapter' } }))
		).rejects.toMatchObject({ code: 'invalid-argument' });
		expect(mockRegenChapter).not.toHaveBeenCalled();
	});

	it('impression で personaId が無ければ invalid-argument', async () => {
		await expect(
			regenHandler(makeRequest({ topicId: 't1', articleElement: { kind: 'impression' } }))
		).rejects.toMatchObject({ code: 'invalid-argument' });
		expect(mockRegenImpression).not.toHaveBeenCalled();
	});

	it('コア関数の失敗は internal に変換する', async () => {
		mockRegenIntro.mockRejectedValueOnce(new Error('llm down'));
		await expect(
			regenHandler(makeRequest({ topicId: 't1', articleElement: { kind: 'intro' } }))
		).rejects.toMatchObject({ code: 'internal' });
	});
});
