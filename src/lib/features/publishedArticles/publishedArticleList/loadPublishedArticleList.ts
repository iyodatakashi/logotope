import { fetchPublishedTopics } from '#lib/stores/publishedTopics.ts';

// SSR で公開一覧を取得して data として渡す。取得失敗は全体エラーにせず失敗状態として渡す（Req 3.3）。
export const loadPublishedArticleList = async () => {
	try {
		const topics = await fetchPublishedTopics();
		return { topics, loadError: false };
	} catch {
		return { topics: [], loadError: true };
	}
};
