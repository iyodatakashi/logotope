import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as repo from '../db/repository.js';
import { ProgressTrackerService } from '../pipeline/progress-tracker.js';
import { requireAuth } from '../utils/auth.js';

async function deleteDebateSessionData(topicId: string): Promise<void> {
  const session = await repo.getDebateSessionByTopicId(topicId);
  if (session) {
    await repo.deleteDebateTurnsBySession(session.id);
    await repo.deletePostDebateCommentsBySession(session.id);
  }
  await repo.deleteDebateSessionByTopicId(topicId);
}

export const resetToPhase1 = onCall(async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };
  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');
  await deleteDebateSessionData(topicId);
  await repo.deletePersonaBeliefsByTopicId(topicId);
  await repo.deletePersonaInterviewsByTopicId(topicId);
  await repo.deletePersonaProfilesByTopicId(topicId);
  await repo.updateTopicStatus(topicId, 'surveying');
  const tracker = new ProgressTrackerService();
  await tracker.updateStatus(topicId, 'surveying');
  return { status: 'ok' };
});

export const resetToPhase2 = onCall(async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };
  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');
  await deleteDebateSessionData(topicId);
  await repo.deletePersonaBeliefsByTopicId(topicId);
  await repo.deletePersonaInterviewsByTopicId(topicId);
  await repo.updateTopicStatus(topicId, 'generating_personas');
  const tracker = new ProgressTrackerService();
  await tracker.updateStatus(topicId, 'generating_personas');
  return { status: 'ok' };
});

export const resetToPhase3 = onCall(async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };
  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');
  await deleteDebateSessionData(topicId);
  await repo.updateTopicStatus(topicId, 'interviewing');
  const tracker = new ProgressTrackerService();
  await tracker.updateStatus(topicId, 'interviewing');
  return { status: 'ok' };
});
