import { loadPublishedArticleDetail } from '#lib/features/publishedArticles/publishedArticleDetail/loadPublishedArticleDetail.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => loadPublishedArticleDetail(params.topicId);
