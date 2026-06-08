<script lang="ts">
	import type { PublishedDebateDetail } from '$lib/types/index.js';
	import DebateViewer from '$lib/components/public/DebateViewer.svelte';
	import PostDebateComments from '$lib/components/public/PostDebateComments.svelte';

	interface Props {
		data: { debate: PublishedDebateDetail };
	}

	let { data }: Props = $props();

	const debate = $derived(data.debate);
	const personaNames = $derived(debate.personas.map((p) => p.name).join('・'));
</script>

<svelte:head>
	<title>{debate.topicTitle} — logotope</title>
	<meta name="description" content="{debate.topicTitle}についての多角的な討論。{personaNames}が参加。" />
	<meta property="og:title" content="{debate.topicTitle} — logotope" />
	<meta
		property="og:description"
		content="{debate.topicTitle}についての多角的な討論。{personaNames}が参加。"
	/>
</svelte:head>

<main class="container">
	<nav class="breadcrumb">
		<a href="/">← 討論一覧</a>
	</nav>

	<header>
		<h1>{debate.topicTitle}</h1>
		<p class="meta">{debate.personas.length}名参加 · {debate.turns.length}ターン</p>
	</header>

	<DebateViewer {debate} />

	{#if debate.postDebateComments.length > 0}
		<PostDebateComments comments={debate.postDebateComments} />
	{/if}
</main>

<style>
	.container {
		max-width: 960px;
		margin: 0 auto;
		padding: 24px 16px;
	}
	.breadcrumb {
		margin-bottom: 16px;
	}
	.breadcrumb a {
		color: #1565c0;
		text-decoration: none;
		font-size: 0.875rem;
	}
	header {
		margin-bottom: 24px;
	}
	h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0 0 8px;
	}
	.meta {
		color: #757575;
		font-size: 0.875rem;
		margin: 0;
	}
</style>
