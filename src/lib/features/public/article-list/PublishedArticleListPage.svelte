<script lang="ts">
	import { navigating } from '$app/state';
	import PublishedArticleListItem from '$lib/features/public/article-list/PublishedArticleListItem.svelte';
	import type { PublishedTopic } from '$lib/models/published/published-topic.types';
	import PublicTemplate from '$lib/features/public/PublicTemplate.svelte';

	interface Props {
		data: {
			topics: PublishedTopic[];
			loadError: boolean;
		};
	}

	let { data }: Props = $props();
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

<PublicTemplate>
	<main class="published-article-list-page">
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
				{#each data.topics as topic (topic.id)}
					<li>
						<PublishedArticleListItem {topic} />
					</li>
				{/each}
			</ul>
		{/if}
	</main>
</PublicTemplate>

<style>
	.published-article-list-page {
		max-width: 720px;
		margin: 0 auto;
		padding: 32px 16px;
	}
	.published-article-list-page__list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
</style>
