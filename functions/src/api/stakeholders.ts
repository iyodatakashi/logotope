import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as repo from '../db/repository.js';
import { StakeholderAnalyzerService } from '../pipeline/stakeholder-analyzer.js';
import { ProgressTrackerService } from '../pipeline/progress-tracker.js';
import { requireAuth } from '../utils/auth.js';
import type { Stakeholder } from '../types/index.js';

export const getStakeholders = onCall(async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };
  const map = await repo.getStakeholderMapByTopicId(topicId);
  if (!map) throw new HttpsError('not-found', 'Stakeholder map not found');
  const stakeholders = JSON.parse(map.content) as Stakeholder[];
  return stakeholders.map((s, i) => ({
    id: `${map.id}-${i}`,
    role: s.role,
    stanceDirection: s.stanceDirection,
    minorityLevel: s.minorityLevel,
    rationale: s.reason,
  }));
});

export const generateStakeholders = onCall({ timeoutSeconds: 300 }, async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };
  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');
  await repo.updateTopicStatus(topicId, 'surveying');
  const service = new StakeholderAnalyzerService();
  await service.analyze(topicId, topic.title);
  return { jobId: topicId };
});

export const approveStakeholders = onCall(async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };
  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');
  const map = await repo.getStakeholderMapByTopicId(topicId);
  if (map) await repo.approveStakeholderMap(map.id);
  await repo.updateTopicStatus(topicId, 'generating_personas');
  const tracker = new ProgressTrackerService();
  await tracker.updateStatus(topicId, 'generating_personas');
  return { status: 'ok' };
});
