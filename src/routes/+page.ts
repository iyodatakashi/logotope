import { loadPublishedArticleList } from '#lib/features/publishedArticles/publishedArticleList/loadPublishedArticleList.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = () => loadPublishedArticleList();
