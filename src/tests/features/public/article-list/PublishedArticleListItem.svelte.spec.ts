import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PublishedArticleListItem from '$lib/features/public/article-list/PublishedArticleListItem.svelte';
import type { PublishedTopic } from '$lib/models/published/published-topic/published-topic.types';

const topic: PublishedTopic = {
	id: 'topic-1',
	title: '消費税増税について',
	// ローカル日付で固定（dayjs の出力文字列を安定させる）
	publishedAt: new Date(2026, 6, 6)
};

const rootOf = () => document.querySelector('li.published-article-list-item') as HTMLElement;

const linkOf = () =>
	document.querySelector('.published-article-list-item__link') as HTMLAnchorElement;

describe('PublishedArticleListItem.svelte', () => {
	it('タイトルを表示する', async () => {
		render(PublishedArticleListItem, { topic, index: 0 });

		await expect.element(page.getByText('消費税増税について')).toBeInTheDocument();
	});

	it('全記事共通の種別ラベルを表示する', async () => {
		render(PublishedArticleListItem, { topic, index: 0 });

		await expect.element(page.getByText('AI討論')).toBeInTheDocument();
	});

	it('公開日を「YYYY年M月D日」形式で表示する（先頭ゼロなし）', async () => {
		render(PublishedArticleListItem, { topic, index: 0 });

		await expect.element(page.getByText('2026年7月6日')).toBeInTheDocument();
	});

	it('記事ページ /articles/{id} へのリンクを持つ', async () => {
		render(PublishedArticleListItem, { topic, index: 0 });

		await expect.element(page.getByRole('link')).toHaveAttribute('href', '/articles/topic-1');
	});

	it('種別ラベル・タイトル・公開日を円（リンク）の内側に置く', () => {
		render(PublishedArticleListItem, { topic, index: 0 });

		const link = linkOf();
		expect(link.querySelector('.published-article-list-item__kind')?.textContent).toBe('AI討論');
		expect(link.querySelector('.published-article-list-item__title')?.textContent).toBe(
			'消費税増税について'
		);
		expect(link.querySelector('.published-article-list-item__published-at')?.textContent).toBe(
			'2026年7月6日'
		);
	});

	it('タイトルを見出し（h2）として置き、円の中で見出し階層が通る', () => {
		render(PublishedArticleListItem, { topic, index: 0 });

		expect(linkOf().querySelector('h2.published-article-list-item__title')).not.toBeNull();
	});

	it('リスト項目として文書構造に載る', () => {
		render(PublishedArticleListItem, { topic, index: 0 });

		expect(rootOf().tagName).toBe('LI');
	});

	it('水平位置の決定に使う値を項目に渡す', () => {
		render(PublishedArticleListItem, { topic, index: 3 });

		expect(rootOf().style.getPropertyValue('--published-article-list-item-index')).toBe('3');
	});

	it('同じ入力には同じ水平位置の値を返す（乱数を使わない）', () => {
		render(PublishedArticleListItem, { topic, index: 3 });
		const first = rootOf().style.getPropertyValue('--published-article-list-item-index');

		document.body.replaceChildren();
		render(PublishedArticleListItem, { topic, index: 3 });
		const second = rootOf().style.getPropertyValue('--published-article-list-item-index');

		expect(second).toBe(first);
	});

	it('水平位置が並び順から周期的に決まる', () => {
		// ずらし幅は記事リスト領域の幅を基準にするため、基準となる入れ物を用意する
		document.body.style.containerType = 'inline-size';
		document.body.style.inlineSize = '1200px';

		const offsetOf = (index: number) => {
			document.body.replaceChildren();
			render(PublishedArticleListItem, { topic, index });
			return getComputedStyle(linkOf()).insetInlineStart;
		};

		const first = offsetOf(0);
		const second = offsetOf(1);
		const fourth = offsetOf(3);
		document.body.style.inlineSize = '';
		document.body.style.containerType = '';

		expect(second).not.toBe(first);
		expect(fourth).toBe(first);
	});

	it('水平位置のずらし量が記事リスト領域の幅に比例する（絶対値ではない）', () => {
		document.body.style.containerType = 'inline-size';
		render(PublishedArticleListItem, { topic, index: 0 });

		const offsetAtWidth = (width: number) => {
			document.body.style.inlineSize = `${width}px`;
			return parseFloat(getComputedStyle(linkOf()).insetInlineStart);
		};

		// 頭打ちが効かない幅どうしで比べる
		const narrow = offsetAtWidth(900);
		const wide = offsetAtWidth(1200);
		document.body.style.inlineSize = '';
		document.body.style.containerType = '';

		expect(narrow).not.toBe(0);
		expect(wide / narrow).toBeCloseTo(1200 / 900, 1);
	});

	it('行そのものは動かさない（動かすのは中の円だけ）', () => {
		render(PublishedArticleListItem, { topic, index: 0 });

		const row = getComputedStyle(rootOf());
		expect(row.position).toBe('static');
		expect(row.translate).toBe('none');
	});

	it('円と内側の要素をまとめてスクロール連動で変倍する', () => {
		render(PublishedArticleListItem, { topic, index: 0 });

		const style = getComputedStyle(linkOf());
		expect(style.animationName).toContain('published-article-list-item-depth');
		expect(style.getPropertyValue('animation-timeline')).not.toBe('auto');
	});

	it('変倍は円全体に掛け、内側テキストへ個別のアニメーションを持たせない', () => {
		render(PublishedArticleListItem, { topic, index: 0 });

		for (const child of linkOf().querySelectorAll('*')) {
			expect(getComputedStyle(child).animationName).toBe('none');
		}
	});
});
