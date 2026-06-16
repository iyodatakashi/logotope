import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFunctions } from 'firebase-admin/functions';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getTopicById, getDebateSessionByTopicId } from '../db/repository.js';
import { DebateOrchestratorService } from '../pipeline/debate-orchestrator.js';
import { DEFAULT_OPTIONS } from '../constants/debate-orchestrator.constants.js';
import { requireAuth } from '../utils/auth.js';

const db = () => getFirestore();
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

  await db().doc(`topics/${topicId}`).update({ phase: 5, phaseStatus: 'running', updatedAt: Timestamp.now() });
  await enqueueChapterTask(topicId, 0, singleChapterMode);

  return { topicId };
});

// 章単位再開: 停止時に進行中だった章の途中ターンを破棄し、当該章を頭から再実行する
export const restartDebate = onCall({ timeoutSeconds: 60 }, async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };

  const topic = await getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');

  const session = await getDebateSessionByTopicId(topicId);
  const chapterIndex = session?.currentChapterIndex ?? 0;
  const chapterId = session?.chapters?.[chapterIndex]?.chapterId;
  if (!chapterId) throw new HttpsError('not-found', 'Chapter not found');

  await discardChapterProgress(topicId, chapterId);
  await db().doc(`topics/${topicId}`).update({ phase: 5, phaseStatus: 'running', updatedAt: Timestamp.now() });
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
        await db().doc(`topics/${topicId}`).update({ phaseStatus: 'stopped', updatedAt: Timestamp.now() });
      }
      throw err;
    }
  }
);

async function discardChapterProgress(topicId: string, chapterId: string): Promise<void> {
  const sessionRef = db().doc(`topics/${topicId}/sessions/0`);
  const snap = await sessionRef.get();
  if (!snap.exists) return;
  const data = snap.data() as {
    turns?: Array<{ id: string; turnIndex: number; chapterId?: string }>;
    chapters?: Array<{ chapterId: string }>;
  };
  const turns = data.turns ?? [];
  const chapters = data.chapters ?? [];

  const targetIdx = chapters.findIndex((c) => c.chapterId === chapterId);
  const discardChapterIds = new Set(
    chapters.slice(targetIdx >= 0 ? targetIdx : 0).map((c) => c.chapterId)
  );
  const removed = turns.filter((t) => t.chapterId && discardChapterIds.has(t.chapterId));
  const kept = turns.filter((t) => !t.chapterId || !discardChapterIds.has(t.chapterId));
  const removedTurnIds = new Set(removed.map((t) => t.id));
  const removedTurnIndexes = removed.map((t) => t.turnIndex);

  await sessionRef.update({
    turns: kept,
    currentChapterIndex: targetIdx >= 0 ? targetIdx : 0,
    postDebateComments: [],
    totalTurns: FieldValue.delete(),
    completedAt: FieldValue.delete(),
  });

  const personasSnap = await db().collection(`topics/${topicId}/personas`).get();
  for (const personaSnap of personasSnap.docs) {
    const pdata = personaSnap.data() as { beliefs?: Array<{ triggeredByTurnId?: string | null }> };
    const beliefs = pdata.beliefs ?? [];
    const filtered = beliefs.filter(
      (b) => !(b.triggeredByTurnId && removedTurnIds.has(b.triggeredByTurnId))
    );
    if (filtered.length !== beliefs.length) {
      await personaSnap.ref.update({ beliefs: filtered });
    }
  }

  if (removedTurnIndexes.length > 0) {
    const engSnap = await db().collection(`topics/${topicId}/sessions/0/engagements`).get();
    const updates: Record<string, unknown> = {};
    for (const ti of removedTurnIndexes) {
      updates[`history.${ti}`] = FieldValue.delete();
    }
    for (const engDoc of engSnap.docs) {
      await engDoc.ref.update(updates);
    }
  }
}
