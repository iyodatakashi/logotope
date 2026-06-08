import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as repo from '../db/repository.js';
import { DebateOrchestratorService } from '../pipeline/debate-orchestrator.js';
import { requireAuth } from '../utils/auth.js';

export const getAdminDebate = onCall(async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };
  const session = await repo.getDebateSessionByTopicId(topicId);
  if (!session) throw new HttpsError('not-found', 'Debate not found');
  const [personas, turns] = await Promise.all([
    repo.getApprovedPersonasByTopicId(topicId),
    repo.getDebateTurnsBySessionId(session.id),
  ]);
  const personaMap = new Map(personas.map((p) => [p.id, p]));
  return {
    id: session.id,
    turns: turns
      .sort((a, b) => a.turnIndex - b.turnIndex)
      .map((t) => {
        const persona = t.personaId ? personaMap.get(t.personaId) : null;
        return {
          id: t.id,
          turnIndex: t.turnIndex,
          speakerType: t.speakerType,
          speakerName: persona?.name ?? 'ファシリテーター',
          speakerRole: persona?.stakeholderRole ?? '',
          content: t.content,
          beliefChangesTriggered: [],
        };
      }),
  };
});

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

export const resetDebate = onCall(async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };
  const session = await repo.getDebateSessionByTopicId(topicId);
  if (session) {
    await repo.deletePostDebateCommentsBySession(session.id);
    await repo.deleteDebateTurnsBySession(session.id);
    await repo.deleteDebateSession(session.id);
  }
  await repo.updateTopicStatus(topicId, 'debating');
  return { status: 'ok' };
});

export const publishDebate = onCall(async (request) => {
  requireAuth(request);
  const { id } = request.data as { id: string };
  const session = await repo.getDebateSessionById(id);
  if (!session) throw new HttpsError('not-found', 'Debate not found');
  await repo.publishDebateSession(id);
  return { status: 'ok', url: `/debate/${id}` };
});
