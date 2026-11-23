<header class="published-article-list-intro">
	<h1 class="published-article-list-intro__logo">logotope</h1>
	<p class="published-article-list-intro__description">
		多様な視点を持ったAIペルソナが討論する実験コンテンツです。
	</p>
</header>

<style>
	.published-article-list-intro {
		display: flex;
		flex-direction: column;
		color: var(--white);
		/* 色の移行はブラウザに委ねる（フレームごとの色計算を自前で行わない） */
		transition: color 600ms;
	}

	.published-article-list-intro__logo {
		font-size: 2rem;
		font-weight: 600;
		line-height: 1.2;
		letter-spacing: 0.05rem;
		margin: 0;
	}

	.published-article-list-intro__description {
		font-size: var(--svelte-ui-font-size);
		margin: 0;
	}

	/* 狭い縦長画面では横並びに畳んで縦の占有を圧縮する（記事の領域に画面の大半を割り当てるため） */
	@media (max-width: 768px) {
		.published-article-list-intro {
			flex-direction: row;
			flex-wrap: wrap;
			align-items: baseline;
			column-gap: 1rem;
		}
	}
</style>
