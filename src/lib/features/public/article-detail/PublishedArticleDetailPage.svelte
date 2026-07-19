<script lang="ts">
	import dayjs from 'dayjs';
	import { navigating } from '$app/state';
	import PublishedChapterIndex from '$lib/features/public/article-detail/PublishedChapterIndex.svelte';
	import PublishedNarration from '$lib/features/public/article-detail/PublishedNarration.svelte';
	import PublishedChapter from '$lib/features/public/article-detail/PublishedChapter.svelte';
	import PublishedImpression from '$lib/features/public/article-detail/PublishedImpression.svelte';
	import type { PublishedArticle } from '$lib/models/published/published-article.types';

	let {
		data
	}: {
		data: { article: PublishedArticle };
	} = $props();

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
	<p class="published-article-detail-page__status">読み込み中...</p>
{:else}
	<div class="published-article-detail-page">
		<aside class="published-article-detail-page__toc">
			<PublishedChapterIndex chapters={article.chapters} />
		</aside>
		<main class="published-article-detail-page__main">
			<header class="published-article-detail-page__header">
				<h1 class="published-article-detail-page__title">{article.title}</h1>
				<span class="published-article-detail-page__published-at">{formattedDate}</span>
			</header>

			{#if article.intro}
				<PublishedNarration label="導入" content={article.intro} />
			{/if}

			{#each article.chapters as chapter (chapter.index)}
				<PublishedChapter {chapter} />
			{/each}

			{#if article.outro}
				<PublishedNarration label="締め" content={article.outro} />
			{/if}

			{#if article.impressions.length > 0}
				<section class="published-article-detail-page__impressions">
					<h2 class="published-article-detail-page__impressions-title">参加者の所感</h2>
					{#each article.impressions as impression (impression.personaId)}
						<PublishedImpression {impression} />
					{/each}
				</section>
			{/if}

			<footer class="published-article-detail-page__footer">
				<a class="published-article-detail-page__home-link" href="/">記事一覧へ戻る</a>
			</footer>
		</main>
	</div>
{/if}

<style>
	.published-article-detail-page {
		max-width: 960px;
		margin: 0 auto;
		padding: 32px 16px;
		display: grid;
		grid-template-columns: 220px 1fr;
		gap: 32px;
		align-items: start;
	}
	.published-article-detail-page__toc {
		position: sticky;
		top: 24px;
	}
	.published-article-detail-page__main {
		min-width: 0;
	}
	.published-article-detail-page__header {
		margin-bottom: 32px;
	}
	.published-article-detail-page__title {
		margin: 0 0 8px;
	}
	.published-article-detail-page__published-at {
		font-size: var(--svelte-ui-font-size-sm);
		color: #757575;
	}
	.published-article-detail-page__impressions {
		margin-top: 32px;
		padding-top: 24px;
		border-top: 1px solid #e0e0e0;
	}
	.published-article-detail-page__impressions-title {
		font-size: 1.25rem;
		margin: 0 0 12px;
	}
	.published-article-detail-page__footer {
		margin-top: 48px;
	}
	.published-article-detail-page__home-link {
		color: #7b1fa2;
		text-decoration: none;
	}
	.published-article-detail-page__home-link:hover {
		text-decoration: underline;
	}
	.published-article-detail-page__status {
		max-width: 960px;
		margin: 0 auto;
		padding: 32px 16px;
		color: #757575;
	}

	/* 狭幅時は目次の固定を解除し単カラムにする（Req 10.1, 10.2）。 */
	@media (max-width: 768px) {
		.published-article-detail-page {
			grid-template-columns: 1fr;
		}
		.published-article-detail-page__toc {
			position: static;
		}
	}
</style>
