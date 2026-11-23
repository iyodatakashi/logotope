import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('$app/state', () => ({ navigating: { to: null } }));

import { render } from 'svelte/server';
import PublishedArticleListPage from '#lib/features/publishedArticles/publishedArticleList/PublishedArticleListPage.svelte';
import type { PublishedTopic } from '#lib/models/publishedTopic/publishedTopic.types.ts';

const PUBLIC_SOURCES = [
	'src/lib/stores/publishedTopics.ts',
	'src/routes/+page.ts',
	'src/routes/+page.svelte',
	'src/lib/features/publishedArticles/publishedArticleList/loadPublishedArticleList.ts',
	'src/lib/features/publishedArticles/publishedArticleList/PublishedArticleListPage.svelte',
	'src/lib/features/publishedArticles/publishedArticleList/PublishedArticleListItem.svelte',
	'src/lib/features/publishedArticles/publishedArticleList/PublishedArticleListIntro.svelte'
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
		const publishedTopics = readFileSync('src/lib/stores/publishedTopics.ts', 'utf8');

		expect(publishedTopics).toContain('#lib/stores/firebasePublic.ts');
		expect(publishedTopics).toContain("where('published', '==', true)");
	});

	it('公開トップの経路が認証・関数呼び出しに依存しない', () => {
		const offending = PUBLIC_SOURCES.filter(({ source }) =>
			/firebase\/auth|firebase\/functions|#lib\/stores\/firebase\.ts|authStore|currentUser/.test(
				source
			)
		).map(({ path }) => path);

		expect(offending).toEqual([]);
	});

	it('公開トップの経路が認証モジュールと到達の制御を読み込まない', () => {
		const offending = PUBLIC_SOURCES.filter(({ source }) =>
			/svelte-firebase-auth|AuthGate|adminAuth/.test(source)
		).map(({ path }) => path);

		expect(offending).toEqual([]);
	});

	it('公開トップが管理用のストア・コンポーネントを流用しない', () => {
		// stores のうち読んでよいのは、公開の取得と公開専用の初期化だけ
		const offending = PUBLIC_SOURCES.filter(({ source }) =>
			/features\/(topics|adminAuth)\/|topicsStore|#lib\/stores\/(?!publishedTopics\.ts|firebasePublic\.ts)/.test(
				source
			)
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
