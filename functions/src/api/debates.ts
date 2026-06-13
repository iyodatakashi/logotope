import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFunctions } from 'firebase-admin/functions';
import * as repo from '../db/repository.js';
import { DebateOrchestratorService } from '../pipeline/debate-orchestrator.js';
import { requireAuth } from '../utils/auth.js';

const REGION = 'asia-northeast1';

async function enqueueChapterTask(topicId: string, chapterIndex: number): Promise<void> {
  const queue = getFunctions().taskQueue(`locations/${REGION}/functions/runChapter`);
  await queue.enqueue({ topicId, chapterIndex }, { scheduleDelaySeconds: 0 });
}

export const generateChapters = onCall({ timeoutSeconds: 120 }, async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };

  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');

  await repo.createDebateSession(topicId, 'chapters_ready');
  const orchestrator = new DebateOrchestratorService();
  await orchestrator.generateChaptersOnly(topicId);
  await repo.updateTopicStatus(topicId, 'chapters_ready');

  return { topicId };
});

export const startDebate = onCall({ timeoutSeconds: 60 }, async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };

  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');

  await repo.updateDebateSessionStatus(topicId, 'debating');
  await repo.updateTopicStatus(topicId, 'debating');
  await enqueueChapterTask(topicId, 0);

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
    const { topicId, chapterIndex } = req.data as { topicId: string; chapterIndex: number };
    try {
      const orchestrator = new DebateOrchestratorService();
      const hasNextChapter = await orchestrator.executeChapterTask(topicId, chapterIndex);
      if (hasNextChapter) {
        await enqueueChapterTask(topicId, chapterIndex + 1);
      }
    } catch (err) {
      // 最終リトライでも失敗した場合のみセッションをエラー終端にする
      if ((req.retryCount ?? 0) >= MAX_ATTEMPTS - 1) {
        await repo.markSessionError(topicId);
      }
      throw err;
    }
  }
);
