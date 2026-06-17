import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFunctions } from 'firebase-admin/functions';
import { getTopicById } from '../pipeline/topics/topics.js';
import { getDebateSessionByTopicId } from '../pipeline/debate/debate-lifecycle.js';
import { executeChapterTask, DEFAULT_OPTIONS } from '../pipeline/debate/debate-orchestrator.js';
import { activateDebate, markDebateStopped, restartChapter } from '../pipeline/debate/debate-lifecycle.js';
import { requireAuth } from '../utils/auth.js';

const REGION = 'asia-northeast1';

async function enqueueChapterTask(topicId: string, chapterIndex: number, singleChapterMode?: boolean): Promise<void> {
  const queue = getFunctions().taskQueue(`locations/${REGION}/functions/runChapter`);
  await queue.enqueue({ topicId, chapterIndex, singleChapterMode }, { scheduleDelaySeconds: 0 });
}

export const startDebate = onCall({ timeoutSeconds: 60 }, async (request) => {
  requireAuth(request);
  const { topicId, singleChapterMode } = request.data as { topicId: string; singleChapterMode?: boolean };

  const topic = await getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');

  await activateDebate(topicId);
  await enqueueChapterTask(topicId, 0, singleChapterMode);

  return { topicId };
});

export const restartDebate = onCall({ timeoutSeconds: 60 }, async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };

  const topic = await getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');

  const session = await getDebateSessionByTopicId(topicId);
  const chapterIndex = session?.currentChapterIndex ?? 0;
  const chapterId = session?.chapters?.[chapterIndex]?.id;
  if (!chapterId) throw new HttpsError('not-found', 'Chapter not found');

  await restartChapter(topicId, chapterId);
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
      const hasNextChapter = await executeChapterTask(topicId, chapterIndex, { ...DEFAULT_OPTIONS, singleChapterMode });
      if (hasNextChapter) {
        await enqueueChapterTask(topicId, chapterIndex + 1, singleChapterMode);
      }
    } catch (err) {
      if ((req.retryCount ?? 0) >= MAX_ATTEMPTS - 1) {
        await markDebateStopped(topicId);
      }
      throw err;
    }
  }
);
