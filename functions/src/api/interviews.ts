import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as repo from '../db/repository.js';
import { InterviewerService } from '../pipeline/interviewer.js';
import { ProgressTrackerService } from '../pipeline/progress-tracker.js';
import { requireAuth } from '../utils/auth.js';

export const getInterviews = onCall(async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };
  const personas = await repo.getApprovedPersonasByTopicId(topicId);
  return Promise.all(
    personas.map(async (p) => {
      const interview = await repo.getPersonaInterviewByPersonaId(p.id);
      return {
        personaId: p.id,
        personaName: p.name,
        interviewRecord: interview?.interviewRecord ?? '',
        status: interview?.status ?? 'pending',
      };
    })
  );
});

export const startInterviews = onCall({ timeoutSeconds: 540 }, async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };
  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');
  const personas = await repo.getApprovedPersonasByTopicId(topicId);
  const service = new InterviewerService();
  await service.interviewAll(topicId, topic.title, personas.map((p) => ({
    id: p.id,
    stakeholderRole: p.stakeholderRole,
    name: p.name,
    age: p.age,
    occupation: p.occupation,
    background: p.background,
    interests: p.interests,
    stanceDirection: p.stanceDirection,
  })));
  return { jobId: topicId };
});

export const retryInterview = onCall({ timeoutSeconds: 300 }, async (request) => {
  requireAuth(request);
  const { topicId, personaId } = request.data as { topicId: string; personaId: string };
  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');
  const personas = await repo.getApprovedPersonasByTopicId(topicId);
  const persona = personas.find((p) => p.id === personaId);
  if (!persona) throw new HttpsError('not-found', 'Persona not found');
  const service = new InterviewerService();
  await service.retryInterview(topicId, topic.title, {
    id: persona.id,
    stakeholderRole: persona.stakeholderRole,
    name: persona.name,
    age: persona.age,
    occupation: persona.occupation,
    background: persona.background,
    interests: persona.interests,
    stanceDirection: persona.stanceDirection,
  });
  return { jobId: personaId };
});

export const approveInterviews = onCall(async (request) => {
  requireAuth(request);
  const { topicId } = request.data as { topicId: string };
  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');
  await repo.updateTopicStatus(topicId, 'debating');
  const tracker = new ProgressTrackerService();
  await tracker.updateStatus(topicId, 'debating');
  return { status: 'ok' };
});
