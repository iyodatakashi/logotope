<script lang="ts">
	import dayjs from 'dayjs';
	import { navigating } from '$app/state';
	import ArticleToc from '$lib/features/public/article-detail/ArticleToc.svelte';
	import ArticleNarration from '$lib/features/public/article-detail/ArticleNarration.svelte';
	import ArticleChapter from '$lib/features/public/article-detail/ArticleChapter.svelte';
	import ArticleImpression from '$lib/features/public/article-detail/ArticleImpression.svelte';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	const article = $derived(data.article);
	const formattedDate = $derived(dayjs(article.publishedAt).format('YYYY年M月D日'));
	const description = $derived(`${article.title}に関する、多様な立場からの公開討論。`);
</script>

<svelte:head>
	<title>{article.title} — logotope</title>
	<meta name="description" content={description} />
	<meta property="og:title" content={article.title} />
	<meta property="og:description" content={description} />
	<meta property="og:type" content="article" />
</svelte:head>

{#if navigating.to}
	<p class="article-page__status">読み込み中...</p>
{:else}
	<div class="article-page">
		<aside class="article-page__toc">
			<ArticleToc chapters={article.chapters} />
		</aside>
		<main class="article-page__main">
			<header class="article-page__header">
				<h1 class="article-page__title">{article.title}</h1>
				<span class="article-page__published-at">{formattedDate}</span>
			</header>

			{#if article.intro}
				<ArticleNarration label="導入" content={article.intro} />
			{/if}

			{#each article.chapters as chapter (chapter.index)}
				<ArticleChapter {chapter} />
			{/each}

			{#if article.outro}
				<ArticleNarration label="締め" content={article.outro} />
			{/if}

			{#if article.impressions.length > 0}
				<section class="article-page__impressions">
					<h2 class="article-page__impressions-title">参加者の所感</h2>
					{#each article.impressions as impression (impression.personaId)}
						<ArticleImpression {impression} />
					{/each}
				</section>
			{/if}

			<footer class="article-page__footer">
				<a class="article-page__home-link" href="/">記事一覧へ戻る</a>
			</footer>
		</main>
	</div>
{/if}

<style>
	.article-page {
		max-width: 960px;
		margin: 0 auto;
		padding: 32px 16px;
		display: grid;
		grid-template-columns: 220px 1fr;
		gap: 32px;
		align-items: start;
	}
	.article-page__toc {
		position: sticky;
		top: 24px;
	}
	.article-page__main {
		min-width: 0;
	}
	.article-page__header {
		margin-bottom: 32px;
	}
	.article-page__title {
		margin: 0 0 8px;
	}
	.article-page__published-at {
		font-size: var(--svelte-ui-font-size-sm);
		color: #757575;
	}
	.article-page__impressions {
		margin-top: 32px;
		padding-top: 24px;
		border-top: 1px solid #e0e0e0;
	}
	.article-page__impressions-title {
		font-size: 1.25rem;
		margin: 0 0 12px;
	}
	.article-page__footer {
		margin-top: 48px;
	}
	.article-page__home-link {
		color: #7b1fa2;
		text-decoration: none;
	}
	.article-page__home-link:hover {
		text-decoration: underline;
	}
	.article-page__status {
		max-width: 960px;
		margin: 0 auto;
		padding: 32px 16px;
		color: #757575;
	}

	/* 狭幅時は目次の固定を解除し単カラムにする（Req 10.1, 10.2）。 */
	@media (max-width: 768px) {
		.article-page {
			grid-template-columns: 1fr;
		}
		.article-page__toc {
			position: static;
		}
	}
</style>
