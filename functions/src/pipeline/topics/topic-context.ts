import { getFirestore } from 'firebase-admin/firestore';
import { getTopicById } from './topics.js';
import type { TopicContext } from '../../types/topic.types.js';
import type { FactBase, FactBaseForFirestore } from '../../types/factBase.types.js';

const db = () => getFirestore();

/**
 * topic doc と factBase/0 から共有コンテキスト（TopicContext）を合成する唯一の BE 権威経路。
 * 全消費者（stakeholder/persona/interview/chapter/debate）はこの経路で同一の事実基盤を得る
 * （フェーズ別分岐を持たない・R9.3）。factBase/0 が存在すればその事実基盤を、無ければ未設定で返す。
 * description/sourceContents は現行の合成ロジック（テーマ説明・参考資料本文）を踏襲する。
 */
export const getTopicContext = async (topicId: string): Promise<TopicContext> => {
	const topic = await getTopicById(topicId);
	if (!topic) throw new Error(`Topic not found: ${topicId}`);

	const description = topic.description;
	const sourceContents = topic.fetchedSourceContents?.map((fc) => fc.content);

	const factSnap = await db().doc(`topics/${topicId}/factBase/0`).get();
	let factBase: FactBase | undefined;
	if (factSnap.exists) {
		const data = factSnap.data() as FactBaseForFirestore;
		factBase = { facts: data.facts, generatedAt: data.generatedAt.toDate() };
	}

	return {
		...(description !== undefined && { description }),
		...(sourceContents !== undefined && { sourceContents }),
		...(factBase !== undefined && { factBase })
	};
};
