<script lang="ts">
	import { navigating } from '$app/state';
	import { prefersReducedMotion } from 'svelte/motion';
	import PublishedArticleListIntro from '$lib/features/public/article-list/PublishedArticleListIntro.svelte';
	import PublishedArticleListItem from '$lib/features/public/article-list/PublishedArticleListItem.svelte';
	import {
		HUE_ORIGIN_DEGREES,
		buildPaletteVariables,
		hueForScroll,
		quantizeHue
	} from '$lib/features/public/article-list/article-list-palette';
	import type { PublishedTopic } from '$lib/models/published/published-topic/published-topic.types';

	interface Props {
		data: {
			topics: PublishedTopic[];
			loadError: boolean;
		};
	}

	let { data }: Props = $props();

	// スクロールするのは文書ではなく記事の領域。グローバルスタイルが html/body を
	// position: fixed / overflow: hidden で固定しているため、この領域が唯一のスクローラになる。
	let scrolledDistance = $state(0);
	let scrollerHeight = $state(0);

	// 色相はスクロール量とスクローラの高さだけで決まる。レイアウトの測定を伴わない。
	// サーバでは両方 0 のままなので起点の色相になる。
	const steppedHue = $derived(quantizeHue(hueForScroll(scrolledDistance, scrollerHeight)));

	// 動きの抑制が設定されている場合は色相を動かさず、起点の色相で固定する
	const appliedHue = $derived(prefersReducedMotion.current ? HUE_ORIGIN_DEGREES : steppedHue);

	// 量子化した色相が変わったときだけパレットを作り直す（スクロールイベントごとには再生成しない）。
	// JS が書くのは離散的な色で、連続的な見えは参照側プロパティの transition が担う。
	const paletteStyle = $derived(
		Object.entries(buildPaletteVariables(appliedHue))
			.map(([name, value]) => `${name}: ${value}`)
			.join('; ')
	);
</script>

<svelte:head>
	<title>logotope</title>
	<meta name="description" content="公開された討論記事の一覧。多様な立場の意見に触れる入口です。" />
	<meta property="og:title" content="logotope — 公開された討論一覧" />
	<meta
		property="og:description"
		content="公開された討論記事の一覧。多様な立場の意見に触れる入口です。"
	/>
</svelte:head>

<main class="published-article-list-page" style={paletteStyle}>
	<div class="published-article-list-page__intro">
		<PublishedArticleListIntro />
	</div>

	<div
		class="published-article-list-page__articles"
		onscroll={(event) => (scrolledDistance = event.currentTarget.scrollTop)}
		bind:clientHeight={scrollerHeight}
	>
		{#if navigating.to}
			<p class="published-article-list-page__status">読み込み中...</p>
		{:else if data.loadError}
			<p class="published-article-list-page__status">
				一覧の取得に失敗しました。時間をおいて再度お試しください。
			</p>
		{:else if data.topics.length === 0}
			<p class="published-article-list-page__status">公開された討論はまだありません。</p>
		{:else}
			<ul class="published-article-list-page__list">
				{#each data.topics as topic, index (topic.id)}
					<PublishedArticleListItem {topic} {index} />
				{/each}
			</ul>
		{/if}
	</div>
</main>

<style>
	.published-article-list-page {
		display: grid;
		grid-template-columns: auto 1fr;
		block-size: 100dvh;
		/*
		 * 色はスクロールに応じて JS がこの要素へ書き込むパレットの段から取る
		 * （--published-article-list-50 … 950 / article-list-palette.ts）。
		 */
		background-color: var(--published-article-list-500);
		transition: background-color 600ms;
	}

	/* 紹介領域は記事の領域と別のグリッドトラックなので、スクロールで流れ去らない */
	.published-article-list-page__intro {
		display: flex;
		flex-direction: column;
		justify-content: start;
		width: 240px;
		padding: 24px;
	}

	/*
	 * 文書ではなくここがスクロールする。円の間隔もこの領域の幅から決まる（cqi の基準）。
	 * 消失点をこの領域の中央に置き、奥へ行った円が小さくなると同時に中央へ寄るようにする。
	 */
	.published-article-list-page__articles {
		position: relative;
		overflow-y: auto;
		min-block-size: 0;
		/* 円の間隔と一覧の前後の余白を、この領域自身の幅・高さから決める（cqi / cqb の基準） */
		container-type: size;
		/*
		 * 投影倍率は 1 / (1 + |Z| / perspective) で、この値と translateZ の比だけで決まる。
		 * 小さくするほど広角（遠ざかりが強い）になる。
		 */
		perspective: 2000px;
	}

	.published-article-list-page__list {
		list-style: none;
		margin: 0;
		padding-inline: 0;
		/* 円の奥行きを上の perspective で投影するため、3D の空間を子へ引き継ぐ */
		transform-style: preserve-3d;
		/*
		 * 一覧の前後の余白は演出上の必須要素。これが無いと先頭と末尾の円だけが
		 * スクローラの中央（標準サイズ）まで到達できない。
		 * 画面高ではなくスクローラ自身の高さ（cqb）が基準。狭い縦長画面では
		 * 紹介領域のぶんスクローラが画面より低くなるため、画面高で取ると余りすぎる。
		 */
		padding-block: calc(50cqb - 20rem / 2);
	}

	.published-article-list-page__status {
		color: var(--white);
		transition: color 600ms;
	}

	/* 狭い縦長画面では単一カラムに切り替え、紹介領域を圧縮して記事の領域に画面の大半を割り当てる */
	@media (max-width: 768px) {
		.published-article-list-page {
			grid-template-columns: 1fr;
			grid-template-rows: auto 1fr;
		}

		.published-article-list-page__intro {
			justify-content: flex-start;
		}
	}
</style>
