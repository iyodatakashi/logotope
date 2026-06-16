import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as repo from '../db/repository.js';
import { requireAuth } from '../utils/auth.js';
import { ChapterGeneratorService } from '../pipeline/chapter-generator.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'];

export const generateChapters = onCall(
  { timeoutSeconds: 120, secrets: SECRETS },
  async (request) => {
    requireAuth(request);
    const { topicId } = request.data as { topicId: string };

    const topic = await repo.getTopicById(topicId);
    if (!topic) throw new HttpsError('not-found', 'Topic not found');

    const personas = (await repo.getPersonasByTopicId(topicId)).filter((p) => p.approved);

    await repo.createDebateSession(topicId);

    const result = await new ChapterGeneratorService().generateChapters(topic.title, personas);
    if (!result.ok) {
      const e = result.error;
      const msg = 'message' in e ? e.message : `${e.code}`;
      throw new HttpsError('internal', msg);
    }

    const { chapters, generalIssues, personaIssues } = result.value;
    await Promise.all([
      repo.saveChapters(topicId, chapters),
      repo.saveChapterIssues(topicId, generalIssues, personaIssues),
    ]);

    return { topicId };
  }
);
