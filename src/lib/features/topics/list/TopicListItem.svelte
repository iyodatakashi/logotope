<script lang="ts">
	import dayjs from 'dayjs';
	import type { Topic } from '$lib/models/topic/createTopic.svelte';

	interface Props {
		topic: Topic;
	}

	let { topic }: Props = $props();

	const formatDate = (date: Date): string => dayjs(date).format('YYYY年M月D日');
</script>

<a href="/debate/{topic.id}" class="topic-list-item">
	<h2 class="topic-list-item__title">{topic.title}</h2>
	<div class="topic-list-item__meta">
		<span class="topic-list-item__persona-count">{topic.personaCount ?? 0}名参加</span>
		{#if topic.publishedAt}
			<span class="topic-list-item__published-at">{formatDate(topic.publishedAt)}</span>
		{/if}
	</div>
</a>

<style>
	.topic-list-item {
		display: block;
		padding: 16px;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		text-decoration: none;
		color: inherit;
		transition: background 0.15s;
	}
	.topic-list-item:hover {
		background: #f5f5f5;
	}
	.topic-list-item__title {
		font-size: 1rem;
		font-weight: bold;
		margin: 0 0 8px;
	}
	.topic-list-item__meta {
		display: flex;
		gap: 12px;
		font-size: var(--svelte-ui-font-size-sm);
		color: #757575;
	}
</style>
