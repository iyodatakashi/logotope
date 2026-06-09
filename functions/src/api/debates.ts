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

export const startDebate = onCall({ timeoutSeconds: 60 }, async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };

  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');

  await repo.createDebateSession(topicId);
  await repo.updateTopicStatus(topicId, 'debating');
  await enqueueChapterTask(topicId, 0);

  return { topicId };
});

export const runChapter = onTaskDispatched(
  {
    timeoutSeconds: 540,
    region: REGION,
    secrets: ['ANTHROPIC_API_KEY'],
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 30 },
    rateLimits: { maxConcurrentDispatches: 5 },
  },
  async (req) => {
    const { topicId, chapterIndex } = req.data as { topicId: string; chapterIndex: number };
    const orchestrator = new DebateOrchestratorService();
    const hasNextChapter = await orchestrator.executeChapterTask(topicId, chapterIndex);
    if (hasNextChapter) {
      await enqueueChapterTask(topicId, chapterIndex + 1);
    }
  }
);
