import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { generateChapters } from '../../agents/chapter-agent.js';
import { getTopicById } from '../topics/topics.js';
import { getPersonasByTopicId } from '../personas/personas.js';

const db = () => getFirestore();

/** セッション作成 → 章生成 → 保存を一貫して実行する */
export const planChapters = async (topicId: string): Promise<void> => {
	const topic = await getTopicById(topicId);
	if (!topic) throw new Error(`Topic not found: ${topicId}`);

	const personas = (await getPersonasByTopicId(topicId)).filter((p) => p.approved);

	const sessionRef = db().doc(`topics/${topicId}/sessions/0`);
	if (!(await sessionRef.get()).exists) {
		await sessionRef.set({ createdAt: Timestamp.now(), turns: [], postDebateComments: [] });
	}

	const result = await generateChapters(topic.title, personas);
	if (!result.ok) {
		const e = result.error;
		throw new Error('message' in e ? e.message : e.code);
	}

	const { chapters, generalIssues, personaIssues } = result.value;
	await db().doc(`topics/${topicId}/sessions/0`).update({
		chapters: chapters.map(({ id, title, focusQuestion }) => ({ id, title, focusQuestion })),
		currentChapterIndex: 0,
		chapterIssues: { general: generalIssues, persona: personaIssues }
	});
};
