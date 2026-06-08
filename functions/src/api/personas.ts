import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as repo from '../db/repository.js';
import { PersonaGeneratorService } from '../pipeline/persona-generator.js';
import { ProgressTrackerService } from '../pipeline/progress-tracker.js';
import { requireAuth } from '../utils/auth.js';
import type { Stakeholder } from '../types/index.js';

export const getPersonas = onCall(async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };
  return repo.getPersonasByTopicId(topicId);
});

export const generatePersonas = onCall({ timeoutSeconds: 300 }, async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };
  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');
  const map = await repo.getStakeholderMapByTopicId(topicId);
  if (!map?.approved) throw new HttpsError('failed-precondition', 'Stakeholder map not approved yet');
  const stakeholders: Stakeholder[] = JSON.parse(map.content) as Stakeholder[];
  await repo.updateTopicStatus(topicId, 'generating_personas');
  const service = new PersonaGeneratorService();
  await service.generate(topicId, topic.title, stakeholders);
  return { jobId: topicId };
});

export const approvePersonas = onCall(async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };
  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');
  await repo.approvePersonaProfiles(topicId);
  await repo.updateTopicStatus(topicId, 'interviewing');
  const tracker = new ProgressTrackerService();
  await tracker.updateStatus(topicId, 'interviewing');
  return { status: 'ok' };
});
