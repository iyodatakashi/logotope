import { getFirestore } from 'firebase-admin/firestore';
import { generateChapters } from '../../agents/chapter-agent.js';
import { getTopicById } from '../topics/topics.js';
import { getTopicContext } from '../topics/topic-context.js';
import { getPersonasByTopicId } from '../personas/personas.js';

const db = () => getFirestore();

/** 章生成 → chapterAnalysis/0 段階的書き込み → chapters コレクション一括 set を実行する */
export const planChapters = async (topicId: string): Promise<void> => {
	const topic = await getTopicById(topicId);
	if (!topic) throw new Error(`Topic not found: ${topicId}`);

	const personas = (await getPersonasByTopicId(topicId)).filter((persona) => persona.approved);
	// BE 権威経路で共有コンテキスト（テーマ説明・参考資料・事実基盤）を合成する。
	const topicContext = await getTopicContext(topicId);

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
					agenda: chapter.agenda ?? [],
					turns: [],
					status: 'pending'
				})
		)
	);
};
