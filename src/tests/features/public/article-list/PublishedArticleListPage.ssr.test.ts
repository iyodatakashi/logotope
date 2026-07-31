import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => ({ navigating: { to: null } }));

import { render } from 'svelte/server';
import PublishedArticleListPage from '$lib/features/public/article-list/PublishedArticleListPage.svelte';
import {
	HUE_ORIGIN_DEGREES,
	buildPaletteVariables
} from '$lib/features/public/article-list/article-list-palette';
import type { PublishedTopic } from '$lib/models/published/published-topic/published-topic.types';

const topics: PublishedTopic[] = [
	{ id: 'topic-1', title: '消費税増税について', publishedAt: new Date(2026, 6, 6) },
	{ id: 'topic-2', title: '女性天皇を認めるべきか', publishedAt: new Date(2026, 5, 1) }
];

const renderPage = (data: { topics: PublishedTopic[]; loadError: boolean }) =>
	render(PublishedArticleListPage, { props: { data } });

describe('PublishedArticleListPage のサーバ描画', () => {
	it('起点の色相のパレットを HTML に含める（初回描画で配色が成立する）', () => {
		const { body } = renderPage({ topics, loadError: false });

		for (const [name, value] of Object.entries(buildPaletteVariables(HUE_ORIGIN_DEGREES))) {
			expect(body).toContain(`${name}: ${value}`);
		}
	});

	it('記事データとリンクを HTML に含める', () => {
		const { body } = renderPage({ topics, loadError: false });

		expect(body).toContain('消費税増税について');
		expect(body).toContain('/articles/topic-1');
		expect(body).toContain('AI討論');
	});

	it('メタ情報を HTML に含める', () => {
		const { head } = renderPage({ topics, loadError: false });

		expect(head).toContain('<title>logotope</title>');
		expect(head).toContain('og:title');
	});

	it('取得済みの記事を取得順のまま 1 度だけ描く', () => {
		const { body } = renderPage({ topics, loadError: false });

		const order = topics.map((topic) => body.indexOf(topic.title));
		expect(order).toEqual([...order].sort((a, b) => a - b));
		expect(body.split('/articles/topic-1').length - 1).toBe(1);
	});
});
