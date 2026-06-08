<script lang="ts">
	import DebateCard from '$lib/components/public/DebateCard.svelte';
	import type { PublishedDebateSummary } from '$lib/types/index.js';

	interface Props {
		data: { debates: PublishedDebateSummary[] };
	}

	let { data }: Props = $props();
</script>

<svelte:head>
	<title>logotope — 多様な視点から議論を可視化</title>
	<meta
		name="description"
		content="AIが多様な立場の意見を公平に可視化する討論プラットフォーム。"
	/>
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

	{#if data.debates.length === 0}
		<p class="empty">公開された討論はまだありません。</p>
	{:else}
		<ul class="debate-list">
			{#each data.debates as debate (debate.id)}
				<li>
					<DebateCard {debate} />
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
	h1 {
		font-size: 2rem;
		font-weight: 700;
		margin: 0 0 8px;
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
