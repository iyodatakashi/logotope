import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as repo from '../db/repository.js';
import { DebateOrchestratorService } from '../pipeline/debate-orchestrator.js';
import { requireAuth } from '../utils/auth.js';

export const startDebate = onCall({ timeoutSeconds: 540 }, async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };
  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');
  const existing = await repo.getDebateSessionByTopicId(topicId);
  const debateSessionId = existing ? existing.id : (await repo.createDebateSession(topicId)).id;
  const orchestrator = new DebateOrchestratorService();
  await orchestrator.run(debateSessionId, topicId);
  return { debateSessionId };
});
