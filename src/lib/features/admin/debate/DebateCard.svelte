<script lang="ts">
	import type { PublishedDebateSummary } from '$lib/models/topic/topic.types.js';

	interface Props {
		debate: PublishedDebateSummary;
	}

	let { debate }: Props = $props();

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('ja-JP', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}
</script>

<a href="/debate/{debate.id}" class="card">
	<h2 class="title">{debate.topicTitle}</h2>
	<div class="meta">
		<span class="persona-count">{debate.personaCount}名参加</span>
		<span class="published-at">{formatDate(debate.publishedAt)}</span>
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
