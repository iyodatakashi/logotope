<script lang="ts">
	import { onMount } from 'svelte';
	import TopicListItem from '$lib/features/topics/list/TopicListItem.svelte';
	import { topicsStore } from '$lib/stores/topics.svelte';
	import type { Topic } from '$lib/models/topic/createTopic.svelte';

	const topics = $derived<Topic[]>(
		topicsStore.topics
			.filter((topic) => topic.publishedAt != null)
			.sort(
				(a, b) =>
					(b.publishedAt?.getTime() ?? b.updatedAt.getTime()) -
					(a.publishedAt?.getTime() ?? a.updatedAt.getTime())
			)
	);

	onMount(() => {
		topicsStore.start();
		return () => topicsStore.stop();
	});
</script>

<svelte:head>
	<title>logotope — 多様な視点から議論を可視化</title>
	<meta name="description" content="AIが多様な立場の意見を公平に可視化する討論プラットフォーム。" />
	<meta property="og:title" content="logotope — 多様な視点から議論を可視化" />
	<meta
		property="og:description"
		content="AIが多様な立場の意見を公平に可視化する討論プラットフォーム。"
	/>
</svelte:head>

<main class="container">
	<header>
		<h1>logotope</h1>
		<p class="tagline">AIが多様な立場の意見を公平に可視化する討論プラットフォーム</p>
	</header>

	{#if !topicsStore.isLoaded}
		<p class="empty">読み込み中...</p>
	{:else if topics.length === 0}
		<p class="empty">公開された討論はまだありません。</p>
	{:else}
		<ul class="debate-list">
			{#each topics as topic (topic.id)}
				<li>
					<TopicListItem {topic} />
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.container {
		max-width: 720px;
		margin: 0 auto;
		padding: 32px 16px;
	}
	header {
		margin-bottom: 32px;
	}
	.tagline {
		color: #555;
		margin: 0;
	}
	.debate-list {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.empty {
		color: #757575;
	}
</style>
