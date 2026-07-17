<script lang="ts">
	import { navigating } from '$app/state';
	import PublishedTopicItem from '$lib/features/public/PublishedTopicItem.svelte';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
</script>

<svelte:head>
	<title>logotope — 公開された討論一覧</title>
	<meta name="description" content="公開された討論記事の一覧。多様な立場の意見に触れる入口です。" />
	<meta property="og:title" content="logotope — 公開された討論一覧" />
	<meta property="og:description" content="公開された討論記事の一覧。多様な立場の意見に触れる入口です。" />
</svelte:head>

<main class="home-page">
	<header class="home-page__header">
		<h1 class="home-page__title">logotope</h1>
	</header>

	{#if navigating.to}
		<p class="home-page__status">読み込み中...</p>
	{:else if data.loadError}
		<p class="home-page__status">一覧の取得に失敗しました。時間をおいて再度お試しください。</p>
	{:else if data.topics.length === 0}
		<p class="home-page__status">公開された討論はまだありません。</p>
	{:else}
		<ul class="home-page__list">
			{#each data.topics as topic (topic.id)}
				<li>
					<PublishedTopicItem {topic} />
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.home-page {
		max-width: 720px;
		margin: 0 auto;
		padding: 32px 16px;
	}
	.home-page__header {
		margin-bottom: 32px;
	}
	.home-page__title {
		margin: 0;
	}
	.home-page__list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.home-page__status {
		color: #757575;
	}
</style>
