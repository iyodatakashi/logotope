import { getFirestore } from 'firebase-admin/firestore';
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

/** 章生成 → chapters コレクション書き込み → chapterAnalysis/0 書き込みを一貫して実行する */
export const planChapters = async (topicId: string): Promise<void> => {
	const topic = await getTopicById(topicId);
	if (!topic) throw new Error(`Topic not found: ${topicId}`);

	const personas = (await getPersonasByTopicId(topicId)).filter((p) => p.approved);
	const topicContext = buildTopicContext(topic);

	const result = await generateChapters(topic.title, personas, topicContext);
	if (!result.ok) {
		const e = result.error;
		throw new Error('message' in e ? e.message : e.code);
	}

	const { chapters, generalIssues, personaIssues } = result.value;

	for (let i = 0; i < chapters.length; i++) {
		const chapter = chapters[i];
		await db().doc(`topics/${topicId}/chapters/${chapter.id}`).set({
			chapterIndex: i,
			title: chapter.title,
			focusQuestion: chapter.focusQuestion,
			discussionPoints: chapter.discussionPoints ?? [],
			turns: [],
			status: 'pending',
		});
	}

	await db().doc(`topics/${topicId}/chapterAnalysis/0`).set({
		general: generalIssues,
		persona: personaIssues,
	});
};
