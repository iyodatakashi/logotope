import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as repo from '../db/repository.js';
import { StakeholderAnalyzerService } from '../pipeline/stakeholder-analyzer.js';
import { requireAuth } from '../utils/auth.js';

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
