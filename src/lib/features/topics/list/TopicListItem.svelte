<script lang="ts">
	import type { Topic } from '$lib/models/topic/topic.types.js';

	interface Props {
		topic: Topic;
	}

	let { topic }: Props = $props();

	function formatDate(date: Date): string {
		return date.toLocaleDateString('ja-JP', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}
</script>

<a href="/debate/{topic.id}" class="card">
	<h2 class="title">{topic.title}</h2>
	<div class="meta">
		<span class="persona-count">{topic.personaCount ?? 0}名参加</span>
		{#if topic.publishedAt}
			<span class="published-at">{formatDate(topic.publishedAt)}</span>
		{/if}
	</div>
</a>

<style>
	.card {
		display: block;
		padding: 16px;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		text-decoration: none;
		color: inherit;
		transition: background 0.15s;
	}
	.card:hover {
		background: #f5f5f5;
	}
	.title {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 8px;
	}
	.meta {
		display: flex;
		gap: 12px;
		font-size: 0.875rem;
		color: #757575;
	}
</style>
