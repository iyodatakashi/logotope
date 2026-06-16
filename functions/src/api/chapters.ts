import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getTopicById, getPersonasByTopicId } from '../db/repository.js';
import { requireAuth } from '../utils/auth.js';
import { ChapterGeneratorService } from '../pipeline/chapter-generator.js';

const db = () => getFirestore();
const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'];

export const generateChapters = onCall(
  { timeoutSeconds: 120, secrets: SECRETS },
  async (request) => {
    requireAuth(request);
    const { topicId } = request.data as { topicId: string };

    const topic = await getTopicById(topicId);
    if (!topic) throw new HttpsError('not-found', 'Topic not found');

    const personas = (await getPersonasByTopicId(topicId)).filter((p) => p.approved);

    const sessionRef = db().doc(`topics/${topicId}/sessions/0`);
    const snap = await sessionRef.get();
    if (!snap.exists) {
      await sessionRef.set({ createdAt: Timestamp.now(), turns: [], postDebateComments: [] });
    }

    const result = await new ChapterGeneratorService().generateChapters(topic.title, personas);
    if (!result.ok) {
      const e = result.error;
      throw new HttpsError('internal', 'message' in e ? e.message : e.code);
    }

    const { chapters, generalIssues, personaIssues } = result.value;
    await db().doc(`topics/${topicId}/sessions/0`).update({
      chapters: chapters.map(({ chapterId, title, focusQuestion }) => ({ chapterId, title, focusQuestion })),
      currentChapterIndex: 0,
      chapterIssues: { general: generalIssues, persona: personaIssues },
    });

    return { topicId };
  }
);
