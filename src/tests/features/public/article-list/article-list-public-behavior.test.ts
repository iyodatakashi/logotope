import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('$app/state', () => ({ navigating: { to: null } }));

import { render } from 'svelte/server';
import PublishedArticleListPage from '$lib/features/public/article-list/PublishedArticleListPage.svelte';
import type { PublishedTopic } from '$lib/models/published/published-topic/published-topic.types';

const PUBLIC_SOURCES = [
	'src/lib/models/published/published-topic/published-topics.ts',
	'src/routes/+page.ts',
	'src/routes/+page.svelte',
	'src/lib/features/public/article-list/PublishedArticleListPage.svelte',
	'src/lib/features/public/article-list/PublishedArticleListItem.svelte',
	'src/lib/features/public/article-list/PublishedArticleListIntro.svelte'
].map((path) => ({ path, source: readFileSync(path, 'utf8') }));

const renderBody = (topics: PublishedTopic[]) =>
	render(PublishedArticleListPage, { props: { data: { topics, loadError: false } } }).body;

const makeTopic = (id: string): PublishedTopic => ({
	id,
	title: `討論 ${id}`,
	publishedAt: new Date(2026, 0, 1)
});

describe('公開挙動の非回帰', () => {
	it('記事の取得経路が公開専用の初期化のみを用いる', () => {
		const publishedTopics = readFileSync(
			'src/lib/models/published/published-topic/published-topics.ts',
			'utf8'
		);

		expect(publishedTopics).toContain('$lib/firebase-public');
		expect(publishedTopics).toContain("where('published', '==', true)");
	});

	it('公開トップの経路が認証・関数呼び出しに依存しない', () => {
		const offending = PUBLIC_SOURCES.filter(({ source }) =>
			/firebase\/auth|firebase\/functions|\$lib\/firebase['"]|authStore|currentUser/.test(source)
		).map(({ path }) => path);

		expect(offending).toEqual([]);
	});

	it('公開トップが管理用のストア・コンポーネントを流用しない', () => {
		const offending = PUBLIC_SOURCES.filter(({ source }) =>
			/features\/admin|topicsStore|\$lib\/stores\//.test(source)
		).map(({ path }) => path);

		expect(offending).toEqual([]);
	});

	it('記事 1 件でも一覧の子が記事だけで、空のスクロール領域を作らない', () => {
		const body = renderBody([makeTopic('only')]);

		expect(body.split('<li').length - 1).toBe(1);
		expect(body).not.toContain('published-article-list-page__spacer');
	});

	it('記事 0 件では一覧そのものを描かず、空のスクロール領域を作らない', () => {
		const body = renderBody([]);

		expect(body).not.toContain('published-article-list-page__list');
		expect(body).toContain('まだありません');
	});

	it('記事のリンクが表示位置によらず文書構造として並ぶ', () => {
		const body = renderBody([makeTopic('a'), makeTopic('b'), makeTopic('c')]);

		const linkOrder = ['a', 'b', 'c'].map((id) => body.indexOf(`/articles/${id}`));
		expect(linkOrder).toEqual([...linkOrder].sort((first, second) => first - second));
		expect(linkOrder.every((position) => position >= 0)).toBe(true);
	});
});
