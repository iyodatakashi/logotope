import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { generateChapters } from '../../agents/chapter-agent.js';
import { getTopicById } from '../topics/topics.js';
import { getPersonasByTopicId } from '../personas/personas.js';
import type { TopicContext } from '../../types/topic.types.js';

const db = () => getFirestore();

const buildTopicContext = (topic: { description?: string; fetchedSourceContents?: { content: string }[] }): TopicContext | undefined => {
	const description = topic.description;
	const sourceContents = topic.fetchedSourceContents?.map((fc) => fc.content);
	if (!description && !sourceContents?.length) return undefined;
	return { description, sourceContents };
};

/** セッション作成 → 章生成 → 保存を一貫して実行する */
export const planChapters = async (topicId: string): Promise<void> => {
	const topic = await getTopicById(topicId);
	if (!topic) throw new Error(`Topic not found: ${topicId}`);

	const personas = (await getPersonasByTopicId(topicId)).filter((p) => p.approved);

	const sessionRef = db().doc(`topics/${topicId}/sessions/0`);
	if (!(await sessionRef.get()).exists) {
		await sessionRef.set({ createdAt: Timestamp.now(), turns: [], postDebateComments: [] });
	}

	const topicContext = buildTopicContext(topic);
	const result = await generateChapters(topic.title, personas, topicContext);
	if (!result.ok) {
		const e = result.error;
		throw new Error('message' in e ? e.message : e.code);
	}

	const { chapters, generalIssues, personaIssues } = result.value;
	await db().doc(`topics/${topicId}/sessions/0`).update({
		chapters: chapters.map(({ id, title, focusQuestion, discussionPoints }) => ({ id, title, focusQuestion, discussionPoints })),
		currentChapterIndex: 0,
		chapterIssues: { general: generalIssues, persona: personaIssues }
	});
};
