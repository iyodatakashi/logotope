import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as repo from '../db/repository.js';
import { InterviewerService } from '../pipeline/interviewer.js';
import { requireAuth } from '../utils/auth.js';

export const runInterview = onCall({ timeoutSeconds: 300 }, async (request) => {
  requireAuth(request);
  const { topicId, personaId } = request.data as { topicId: string; personaId: string };
  const topic = await repo.getTopicById(topicId);
  if (!topic) throw new HttpsError('not-found', 'Topic not found');
  const personas = (await repo.getPersonasByTopicId(topicId)).filter((p) => p.approved);
  const persona = personas.find((p) => p.id === personaId);
  if (!persona) throw new HttpsError('not-found', 'Persona not found');
  const service = new InterviewerService();
  const result = await service.runInterview(topicId, topic.title, {
    id: persona.id,
    stakeholderRole: persona.stakeholderRole,
    name: persona.name,
    age: persona.age,
    occupation: persona.occupation,
    background: persona.background,
    interests: persona.interests,
    stanceDirection: persona.stanceDirection,
  });
  if (!result.ok) throw new HttpsError('internal', 'message' in result.error ? result.error.message : result.error.code);
  return { ok: true };
});
