import { collection, query, where, getDocs } from 'firebase/firestore';
import { publicDb } from '$lib/firebase-public';
import type { PublishedTopic } from './published-topic.types';
import type { TopicForFirestore } from '$lib/models/topic/topic.types';

// 公開済み（published == true）のみを取得し、PublishedTopic へ射影して publishedAt 降順で返す。
// 未認証で呼べる（限定クエリが firestore.rules の published == true に適合する）。
export const fetchPublishedTopics = async (): Promise<PublishedTopic[]> => {
	const publishedQuery = query(collection(publicDb, 'topics'), where('published', '==', true));
	const snapshot = await getDocs(publishedQuery);

	const topics: PublishedTopic[] = [];
	for (const docSnapshot of snapshot.docs) {
		const data = docSnapshot.data() as TopicForFirestore;
		// publishedAt 欠落（publish 操作は両フィールドを書くため通常発生しない）は安全側で除外する。
		if (!data.publishedAt) continue;
		topics.push({ id: docSnapshot.id, title: data.title, publishedAt: data.publishedAt.toDate() });
	}

	return topics.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
};
