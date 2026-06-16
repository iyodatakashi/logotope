import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFunctions } from 'firebase-admin/functions';
import * as repo from '../db/repository.js';
import { DebateOrchestratorService } from '../pipeline/debate-orchestrator.js';
import { DEFAULT_OPTIONS } from '../constants/debate-orchestrator.constants.js';
import { requireAuth } from '../utils/auth.js';

const REGION = 'asia-northeast1';

async function enqueueChapterTask(topicId: string, chapterIndex: number, singleChapterMode?: boolean): Promise<void> {
  const queue = getFunctions().taskQueue(`locations/${REGION}/functions/runChapter`);
  await queue.enqueue({ topicId, chapterIndex, singleChapterMode }, { scheduleDelaySeconds: 0 });
}

export const generateChapters = onCall({ timeoutSeconds: 120 }, async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };

  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');

  // 章立てはクライアント権威。Functions はセッション作成と章立て生成のみ行い、
  // トピックの状態書き込みは行わない（client が解決後に (4, generated) を書く）。
  await repo.createDebateSession(topicId);
  const orchestrator = new DebateOrchestratorService();
  await orchestrator.generateChaptersOnly(topicId);

  return { topicId };
});

export const startDebate = onCall({ timeoutSeconds: 60 }, async (request) => {
  requireAuth(request);
  const { topicId, singleChapterMode } = request.data as { topicId: string; singleChapterMode?: boolean };

  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');

  await repo.updateTopicPhase(topicId, 5, 'running');
  await enqueueChapterTask(topicId, 0, singleChapterMode);

  return { topicId };
});

// 章単位再開: 停止時に進行中だった章の途中ターンを破棄し、当該章を頭から再実行する
export const restartDebate = onCall({ timeoutSeconds: 60 }, async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };

  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');

  const session = await repo.getDebateSessionByTopicId(topicId);
  const chapterIndex = session?.currentChapterIndex ?? 0;
  const chapterId = session?.chapters?.[chapterIndex]?.chapterId;
  if (!chapterId) throw new HttpsError('not-found', 'Chapter not found');

  await repo.discardChapterProgress(topicId, chapterId);
  await repo.updateTopicPhase(topicId, 5, 'running');
  await enqueueChapterTask(topicId, chapterIndex);

  return { topicId };
});

const MAX_ATTEMPTS = 3;

export const runChapter = onTaskDispatched(
  {
    timeoutSeconds: 540,
    region: REGION,
    secrets: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'],
    retryConfig: { maxAttempts: MAX_ATTEMPTS, minBackoffSeconds: 30 },
    rateLimits: { maxConcurrentDispatches: 5 },
  },
  async (req) => {
    const { topicId, chapterIndex, singleChapterMode } = req.data as { topicId: string; chapterIndex: number; singleChapterMode?: boolean };
    try {
      const orchestrator = new DebateOrchestratorService(undefined, undefined, undefined, { ...DEFAULT_OPTIONS, singleChapterMode });
      const hasNextChapter = await orchestrator.executeChapterTask(topicId, chapterIndex);
      if (hasNextChapter) {
        await enqueueChapterTask(topicId, chapterIndex + 1, singleChapterMode);
      }
    } catch (err) {
      // 最終リトライでも失敗した場合のみトピックを停止状態にする
      if ((req.retryCount ?? 0) >= MAX_ATTEMPTS - 1) {
        await repo.markTopicStopped(topicId);
      }
      throw err;
    }
  }
);
