import { getFirestore } from 'firebase-admin/firestore';
import { generateChapters } from '../../agents/chapter-agent.js';
import { getTopicById } from '../topics/topics.js';
import { getPersonasByTopicId } from '../personas/personas.js';
import type { TopicContext } from '../../types/topic.types.js';

const db = () => getFirestore();

const buildTopicContext = (topic: {
	description?: string;
	fetchedSourceContents?: { content: string }[];
}): TopicContext | undefined => {
	const description = topic.description;
	const sourceContents = topic.fetchedSourceContents?.map((fc) => fc.content);
	if (!description && !sourceContents?.length) return undefined;
	return { description, sourceContents };
};

/** 章生成 → chapterAnalysis/0 段階的書き込み → chapters コレクション一括 set を実行する */
export const planChapters = async (topicId: string): Promise<void> => {
	const topic = await getTopicById(topicId);
	if (!topic) throw new Error(`Topic not found: ${topicId}`);

	const personas = (await getPersonasByTopicId(topicId)).filter((p) => p.approved);
	const topicContext = buildTopicContext(topic);

	const result = await generateChapters(topic.title, personas, topicContext, async (progress) => {
		if (progress.step === 'issues_generated') {
			await db().doc(`topics/${topicId}/chapterAnalysis/0`).set({ issues: progress.issues });
		} else if (progress.step === 'issues_scored') {
			await db().doc(`topics/${topicId}/chapterAnalysis/0`).update({ issues: progress.issues });
		} else if (progress.step === 'issues_grouped') {
			await db()
				.doc(`topics/${topicId}/chapterAnalysis/0`)
				.update({ issueGroups: progress.issueGroups });
		}
	});

	if (!result.ok) {
		const e = result.error;
		throw new Error('message' in e ? e.message : e.code);
	}

	const chapters = result.value;

	await Promise.all(
		chapters.map((chapter, i) =>
			db()
				.doc(`topics/${topicId}/chapters/${chapter.id}`)
				.set({
					chapterIndex: i,
					title: chapter.title,
					focusQuestion: chapter.focusQuestion,
					discussionPoints: chapter.discussionPoints ?? [],
					turns: [],
					status: 'pending'
				})
		)
	);
};
