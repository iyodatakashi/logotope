<script lang="ts">
	import dayjs from 'dayjs';
	import type { PublishedTopic } from '$lib/models/published/published-topic/published-topic.types';

	interface Props {
		topic: PublishedTopic;
		/** 一覧の並び順。水平位置の決定に使う（乱数を使わないため再描画・再訪で変わらない）。 */
		index: number;
	}

	let { topic, index }: Props = $props();

	const formattedDate = $derived(dayjs(topic.publishedAt).format('YYYY年M月D日'));
</script>

<li class="published-article-list-item" style:--published-article-list-item-index={index}>
	<a href="/articles/{topic.id}" class="published-article-list-item__link">
		<span class="published-article-list-item__kind">AI討論</span>
		<h2 class="published-article-list-item__title" lang="ja">{topic.title}</h2>
		<span class="published-article-list-item__published-at">{formattedDate}</span>
	</a>
</li>

<style>
	/*
	 * 行。幅は記事リスト領域いっぱいで、この要素自体は動かさない（動かすのは中の円だけ）。
	 * 持つのはレイアウト上のスロット高だけで、直径より小さく取ったぶんだけ円が重なる。
	 *
	 * 横が詰まったぶん縦を伸ばす:
	 * ・直径 ÷ 3（列数）: 同じ列に戻る円どうしの下限。横のずれが 0 なので縦だけで担保する
	 * ・直径 − ずらし幅: 隣どうしの下限。横に離れたぶんは縦を詰めてよい
	 */
	.published-article-list-item {
		block-size: max(calc(20rem / 3), calc(20rem - min(100cqi * 0.3, calc((100cqi - 20rem) / 2))));
	}

	.published-article-list-item__link {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		text-decoration: none;
		/* 寸法は標準サイズの 1 通りだけ。内側テキストの比は変倍率によらず一定になる */
		box-sizing: border-box;
		inline-size: 20rem;
		aspect-ratio: 1;
		border-radius: 50%;
		padding: 2.5rem;
		gap: 0.5rem;
		background-color: var(--white);
		color: var(--published-article-list-900);
		/* 行の中央を基準位置にする */
		margin-inline: auto;
		/* 色の移行はブラウザに委ねる（フレームごとの色計算を自前で行わない） */
		transition:
			background-color 600ms,
			color 600ms;

		/*
		 * 記事ごとに一定の水平位置。並び順だけで決まるためサーバ描画とクライアント描画で一致する。
		 * ずらし幅は記事リスト領域の幅（cqi）の 0.3 倍。ただし端の円が領域からはみ出す量で頭打ちに
		 * する（はみ出すと左の円がスクロールでも到達できない位置に切り取られる）。
		 * translate の % は自分自身の幅が基準になってしまうため使わない。
		 */
		position: relative;
		inset-inline-start: calc(
			min(100cqi * 0.3, calc((100cqi - 20rem) / 2)) *
				(mod(var(--published-article-list-item-index), 3) - 1)
		);

		/* フォーカスによるスクロールの着地点を端から離し、標準サイズで着地させる（対象はこの要素） */
		scroll-margin-block: 30dvh;

		/* 円と内側の要素をまとめて一体で変倍する（直径とフォントサイズを個別に算出しない） */
		/* 直線的な変倍だと通り過ぎ方が硬いので、各区間にイーズインアウトを掛ける */
		animation: published-article-list-item-scale ease-in-out both;
		animation-timeline: view();
		animation-range: cover 0% cover 100%;
	}

	/*
	 * 下部で縮小 → 画面中央で標準 → 上部で再び縮小して消える。
	 * z-index を同じキーフレームで動かし、大きい円ほど前面に来るようにする
	 * （別々に持つと大きさと重なり順が食い違う）。
	 */
	@keyframes published-article-list-item-scale {
		0% {
			scale: 0.4;
			opacity: 0;
			filter: blur(8px);
			z-index: 0;
		}
		/*
		 * 閾値。ここから内側は前面にいるものとして扱い、透過とぼかしを掛けない。
		 * 透過とぼかしで同じオフセットを使うので、はっきり見え始める位置が一致する。
		 */
		40% {
			opacity: 1;
			filter: blur(0);
		}
		50% {
			scale: 1;
			z-index: 100;
		}
		60% {
			opacity: 1;
			filter: blur(0);
		}
		100% {
			scale: 0.4;
			opacity: 0;
			filter: blur(8px);
			z-index: 0;
		}
	}

	.published-article-list-item__kind {
		font-size: var(--svelte-ui-font-size-xs);
		color: var(--published-article-list-700);
		transition: color 600ms;
	}

	.published-article-list-item__title {
		font-size: var(--svelte-ui-font-size-xl);
		line-height: 1.5;
		margin: 0;
		/* タイトルが長くても円の内側に収め、円の形状を崩さない */
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		word-break: auto-phrase;
		overflow: hidden;
	}

	.published-article-list-item__published-at {
		font-size: var(--svelte-ui-font-size-xs);
		color: var(--published-article-list-700);
		transition: color 600ms;
	}

	/*
	 * スクロール駆動アニメーション未対応時と動きの抑制時は等倍表示にフォールバックする。
	 * animation を外すだけでリンクと情報は完全に保たれる。
	 */
	@supports not (animation-timeline: view()) {
		.published-article-list-item__link {
			animation: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.published-article-list-item__link {
			animation: none;
		}
	}
</style>
