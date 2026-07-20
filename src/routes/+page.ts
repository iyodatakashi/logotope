import { fetchPublishedTopics } from '$lib/models/published/published-topic/published-topics';
import type { PageLoad } from './$types';

// SSR で公開一覧を取得して data として渡す。取得失敗は全体エラーにせず失敗状態として渡す（Req 3.3）。
export const load: PageLoad = async () => {
	try {
		const topics = await fetchPublishedTopics();
		return { topics, loadError: false };
	} catch {
		return { topics: [], loadError: true };
	}
};
