import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

// クライアント遷移中の読み込み分岐は navigating に依存する。非遷移状態に固定し data 駆動の分岐を検証する。
vi.mock('$app/state', () => ({ navigating: { to: null } }));

import { tick } from 'svelte';
import PublishedArticleListPage from '$lib/features/public/article-list/PublishedArticleListPage.svelte';
import {
	HUE_ORIGIN_DEGREES,
	buildPaletteVariables,
	hueForScroll,
	quantizeHue
} from '$lib/features/public/article-list/article-list-palette';
import type { PublishedTopic } from '$lib/models/published/published-topic/published-topic.types';

const topics: PublishedTopic[] = [
	{ id: 'topic-1', title: '消費税増税について', publishedAt: new Date(2026, 6, 6) },
	{ id: 'topic-2', title: '女性天皇を認めるべきか', publishedAt: new Date(2026, 5, 1) }
];

const rootOf = () => document.querySelector('.published-article-list-page') as HTMLElement;

const introOf = () => document.querySelector('.published-article-list-intro');

const articlesOf = () => document.querySelector('.published-article-list-page__articles');

const statusOf = () => document.querySelector('.published-article-list-page__status');

describe('PublishedArticleListPage.svelte', () => {
	it('通常時は記事の領域に一覧を描画し、紹介領域も描画する', async () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		await expect.element(page.getByText('消費税増税について')).toBeInTheDocument();
		expect(articlesOf()?.querySelector('.published-article-list-page__list')).not.toBeNull();
		expect(introOf()).not.toBeNull();
	});

	it('記事 0 件のとき、記事の領域の中にその旨を描画し、紹介領域も描画する', async () => {
		render(PublishedArticleListPage, { data: { topics: [], loadError: false } });

		await expect.element(page.getByText(/まだありません/)).toBeInTheDocument();
		expect(articlesOf()?.contains(statusOf())).toBe(true);
		expect(introOf()).not.toBeNull();
	});

	it('取得失敗のとき、記事の領域の中に失敗と次の行動を描画し、紹介領域も描画する', async () => {
		render(PublishedArticleListPage, { data: { topics: [], loadError: true } });

		await expect.element(page.getByText(/取得に失敗/)).toBeInTheDocument();
		await expect.element(page.getByText(/時間をおいて/)).toBeInTheDocument();
		expect(articlesOf()?.contains(statusOf())).toBe(true);
		expect(introOf()).not.toBeNull();
	});

	it('公開ページ共通の枠（PublicTemplate）を使わない', () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		expect(document.querySelector('.public-template')).toBeNull();
	});

	it('管理（admin）への導線を表示しない', () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		expect(page.getByRole('link', { name: /admin|管理/ }).elements()).toHaveLength(0);
	});

	it('すべての記事へのリンクを文書構造として提供する', () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		const items = document.querySelectorAll('.published-article-list-page__list > li');
		expect(items).toHaveLength(topics.length);
	});

	it('各項目に並び順から決まる水平位置の値を渡す', () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		const indexes = Array.from(
			document.querySelectorAll<HTMLElement>('.published-article-list-item')
		).map((item) => item.style.getPropertyValue('--published-article-list-item-index'));

		expect(indexes).toEqual(['0', '1']);
	});

	it('スクロール量 0 では起点の色相のパレットをページのルート要素へ適用する', () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		const expected = buildPaletteVariables(HUE_ORIGIN_DEGREES);
		const root = rootOf();
		for (const [name, value] of Object.entries(expected)) {
			expect(root.style.getPropertyValue(name)).toBe(value);
		}
	});

	it('スクロールで変わる色はパレットの段から取る', () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		const colorOf = (selector: string, property: 'background-color' | 'color') =>
			getComputedStyle(document.querySelector(selector) as HTMLElement).getPropertyValue(property);

		// 段の変数が解決されて実際の色になっている（未定義なら初期値のままになる）
		expect(colorOf('.published-article-list-page', 'background-color')).not.toBe(
			'rgba(0, 0, 0, 0)'
		);
		expect(colorOf('.published-article-list-item__title', 'color')).not.toBe('rgba(0, 0, 0, 0)');
		expect(Object.keys(buildPaletteVariables(HUE_ORIGIN_DEGREES))).toHaveLength(11);
	});

	it('色を実際に適用する要素に移行アニメーションを掛ける', () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		const transitionOf = (selector: string) =>
			getComputedStyle(document.querySelector(selector) as HTMLElement).transitionProperty;

		expect(transitionOf('.published-article-list-page')).toContain('background-color');
		expect(transitionOf('.published-article-list-intro')).toContain('color');
		expect(transitionOf('.published-article-list-item__link')).toContain('background-color');
		expect(transitionOf('.published-article-list-item__link')).toContain('color');
	});

	it('取得済みの記事を取得順のまま 1 度だけ描く', () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		const titles = Array.from(document.querySelectorAll('.published-article-list-item__title')).map(
			(title) => title.textContent
		);

		expect(titles).toEqual(topics.map((topic) => topic.title));
	});

	it('一覧の後ろに空のスクロール領域を作らない', () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		const list = articlesOf()?.querySelector('.published-article-list-page__list');
		expect(list?.nextElementSibling).toBeNull();
		expect(articlesOf()?.lastElementChild).toBe(list);
	});

	it('記事の領域がスクローラになっている（文書ではなくこの領域がスクロールする）', () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		const articles = articlesOf() as HTMLElement;

		expect(getComputedStyle(articles).overflowY).toBe('auto');
		expect(articles.scrollHeight).toBeGreaterThan(articles.clientHeight);
	});

	it('記事の領域に横スクロールが発生しない', () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		const articles = articlesOf() as HTMLElement;

		expect(articles.scrollWidth).toBeLessThanOrEqual(articles.clientWidth);
	});

	it('水平にずらした円が記事の領域からはみ出して見切れない', () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		const area = (articlesOf() as HTMLElement).getBoundingClientRect();
		const circles = Array.from(
			document.querySelectorAll<HTMLElement>('.published-article-list-item__link')
		).map((circle) => circle.getBoundingClientRect());

		expect(circles.length).toBeGreaterThan(0);
		for (const circle of circles) {
			const context = `領域 ${area.width}px / 円 ${circle.width}px`;
			// スクロールコンテナの左外へ出た内容はスクロールで到達できず切り取られる
			expect(circle.left - area.left, context).toBeGreaterThanOrEqual(0);
			expect(area.right - circle.right, context).toBeGreaterThanOrEqual(0);
		}
	});

	it('記事リスト領域の幅に比例して円の水平位置が変わる', () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		const measureAt = (width: number) => {
			document.body.style.inlineSize = `${width}px`;
			const area = (articlesOf() as HTMLElement).getBoundingClientRect();
			const circle = (
				document.querySelector('.published-article-list-item__link') as HTMLElement
			).getBoundingClientRect();
			// 領域の中心から円の中心までのずれ（変倍は中心基準なので中心位置には影響しない）
			return {
				areaWidth: area.width,
				offset: circle.left + circle.width / 2 - (area.left + area.width / 2)
			};
		};

		const narrow = measureAt(1000);
		const wide = measureAt(1600);
		document.body.style.inlineSize = '';

		const report = `幅 ${narrow.areaWidth}px→ずれ ${narrow.offset}px / 幅 ${wide.areaWidth}px→ずれ ${wide.offset}px`;

		expect(narrow.offset, report).not.toBe(0);
		expect(wide.offset / narrow.offset, report).toBeCloseTo(wide.areaWidth / narrow.areaWidth, 1);
	});

	it('記事の領域のスクロール量に応じてパレットを作り直す', async () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		const articles = articlesOf() as HTMLElement;
		const scrolled = Math.min(articles.clientHeight, articles.scrollHeight - articles.clientHeight);
		articles.scrollTop = scrolled;
		articles.dispatchEvent(new Event('scroll'));
		await tick();

		const expected = buildPaletteVariables(
			quantizeHue(hueForScroll(articles.scrollTop, articles.clientHeight))
		);
		const root = rootOf();
		for (const [name, value] of Object.entries(expected)) {
			expect(root.style.getPropertyValue(name)).toBe(value);
		}
		// 起点の色相から実際に動いていること（スクロールしても色が変わらない回帰の検知）
		expect(root.style.getPropertyValue('--published-article-list-500')).not.toBe(
			buildPaletteVariables(HUE_ORIGIN_DEGREES)['--published-article-list-500']
		);
	});

	it('重なり順を大きさと同じ進捗で決める（大きい円が前面に来る）', async () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });
		// スクロール駆動アニメーションの値は次のフレームで反映される
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

		const circles = Array.from(
			document.querySelectorAll<HTMLElement>('.published-article-list-item__link')
		).map((circle) => ({
			width: circle.getBoundingClientRect().width,
			layer: Number(getComputedStyle(circle).zIndex)
		}));

		// 文書順まかせ（auto）ではなく、変倍と同じ進捗から重なり順が決まる
		const report = circles.map((circle) => `${circle.width}px→z ${circle.layer}`).join(' / ');
		for (const circle of circles) {
			expect(Number.isNaN(circle.layer), report).toBe(false);
		}

		// 大きい円ほど手前に来る
		const sortedBySize = [...circles].sort((a, b) => a.width - b.width);
		for (let index = 1; index < sortedBySize.length; index++) {
			expect(sortedBySize[index].layer).toBeGreaterThanOrEqual(sortedBySize[index - 1].layer);
		}
	});

	it('キーボードだけですべての記事へ到達できる', () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		const links = Array.from(
			document.querySelectorAll<HTMLAnchorElement>('.published-article-list-item__link')
		);

		expect(links).toHaveLength(topics.length);
		for (const link of links) {
			link.focus();
			expect(document.activeElement).toBe(link);
		}
	});

	it('画面外の円へフォーカスが移ったとき、着地点を画面の端から離す', () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		// フォーカスが当たるのは円（リンク）なので、着地点の余地もそこに必要
		const link = document.querySelector('.published-article-list-item__link') as HTMLElement;
		const scrollMargin = getComputedStyle(link).scrollMarginBlockStart;

		expect(scrollMargin).not.toBe('0px');
		expect(parseFloat(scrollMargin)).toBeGreaterThan(0);
	});

	it('円はすべて記事に対応し、支援技術から隠される要素が無い', () => {
		render(PublishedArticleListPage, { data: { topics, loadError: false } });

		expect(rootOf().querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
		expect(document.querySelectorAll('.published-article-list-item')).toHaveLength(topics.length);
	});
});
