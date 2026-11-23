import { error } from '@sveltejs/kit';
import { fetchPublishedArticle } from '#lib/stores/publishedArticle.ts';

// 公開記事を SSR で取得し、記事なし（不在・未公開・permission-denied → null）は 404、
// それ以外の取得失敗（throw）は 500 に写像する（Req 5.1-5.3, 6.3, 7.2, 7.3）。
export const loadPublishedArticleDetail = async (topicId: string) => {
	let article;
	try {
		article = await fetchPublishedArticle(topicId);
	} catch {
		error(500, 'fetch-failed');
	}
	if (!article) {
		error(404, 'not-found');
	}
	return { article };
};
