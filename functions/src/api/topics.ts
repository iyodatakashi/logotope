import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as repo from '../db/repository.js';
import { requireAuth } from '../utils/auth.js';

export const createTopic = onCall(async (request) => {
  requireAuth(request);
  const { title } = request.data as { title?: string };
  if (!title || title.trim().length === 0) throw new HttpsError('invalid-argument', 'title is required');
  if (title.length > 500) throw new HttpsError('invalid-argument', 'title must be 500 characters or less');
  const { id } = await repo.createTopic(title.trim());
  return { topicId: id };
});

export const listTopics = onCall(async (request) => {
  requireAuth(request);
  return repo.listTopics();
});

export const getTopic = onCall(async (request) => {
  requireAuth(request);
  const { id } = request.data as { id: string };
  const topic = await repo.getTopicById(id);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');
  return topic;
});
