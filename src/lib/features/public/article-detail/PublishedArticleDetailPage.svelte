<script lang="ts">
	import dayjs from 'dayjs';
	import { navigating } from '$app/state';
	import PublicTemplate from '$lib/features/public/PublicTemplate.svelte';
	import PublishedChapterIndex from '$lib/features/public/article-detail/PublishedChapterIndex.svelte';
	import PublishedChapter from '$lib/features/public/article-detail/PublishedChapter.svelte';
	import PublishedImpressionItem from '$lib/features/public/article-detail/PublishedImpressionItem.svelte';
	import type { PublishedArticle } from '$lib/models/published/published-article/published-article.types';

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

<PublicTemplate>
	{#if navigating.to}
		読み込み中...
	{:else}
		<div class="published-article-detail-page">
			<aside class="published-article-detail-page__chapter-index">
				<PublishedChapterIndex chapters={article.chapters} />
			</aside>
			<main class="published-article-detail-page__main">
				<header class="published-article-detail-page__header">
					<h1 class="published-article-detail-page__title">{article.title}</h1>
					<span class="published-article-detail-page__published-at">{formattedDate}</span>
				</header>

				<div class="published-article-detail-page__sections">
					{#if article.intro}
						{article.intro}
					{/if}

					{#each article.chapters as chapter (chapter.index)}
						<PublishedChapter {chapter} personas={article.personas} />
					{/each}

					{#if article.outro}
						{article.outro}
					{/if}

					{#if article.impressions.length > 0}
						<section class="published-article-detail-page__impressions-section">
							<h2 class="published-article-detail-page__impressions-title">
								討論を終えて〜参加者の所感
							</h2>
							<div class="published-article-detail-page__impressions">
								{#each article.impressions as impression (impression.personaId)}
									<PublishedImpressionItem {impression} personas={article.personas} />
								{/each}
							</div>
						</section>
					{/if}
				</div>
			</main>
		</div>
	{/if}
</PublicTemplate>

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
	.published-article-detail-page__chapter-index {
		position: sticky;
		top: 24px;
	}
	.published-article-detail-page__main {
		display: flex;
		flex-direction: column;
		gap: 48px;
	}
	.published-article-detail-page__header {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.published-article-detail-page__title {
		font-size: 2rem;
		font-weight: bold;
		line-height: normal;
		word-break: auto-phrase;
	}

	.published-article-detail-page__sections {
		display: flex;
		flex-direction: column;
		gap: 48px;
	}

	.published-article-detail-page__impressions-section {
		display: flex;
		flex-direction: column;
		gap: 24px;
		padding: 24px;
		background: var(--base-50);
		border-radius: 16px;
	}
	.published-article-detail-page__impressions-title {
		font-size: var(--svelte-ui-font-size-xl);
		font-weight: bold;
	}
	.published-article-detail-page__impressions {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	/* 狭幅時は目次の固定を解除し単カラムにする（Req 10.1, 10.2）。 */
	@media (max-width: 768px) {
		.published-article-detail-page {
			grid-template-columns: 1fr;
		}
	}
</style>
