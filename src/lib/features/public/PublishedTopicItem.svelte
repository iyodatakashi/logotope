<script lang="ts">
	import dayjs from 'dayjs';
	import type { PublishedTopic } from '$lib/models/published/published-topic.types';

	interface Props {
		topic: PublishedTopic;
	}

	let { topic }: Props = $props();

	const formattedDate = $derived(dayjs(topic.publishedAt).format('YYYY年M月D日'));
</script>

<a href="/articles/{topic.id}" class="published-topic-item">
	<h2 class="published-topic-item__title">{topic.title}</h2>
	<span class="published-topic-item__published-at">{formattedDate}</span>
</a>

<style>
	.published-topic-item {
		display: block;
		padding: 16px;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		text-decoration: none;
		color: inherit;
		transition: background 0.15s;
	}
	.published-topic-item:hover {
		background: #f5f5f5;
	}
	.published-topic-item__title {
		font-size: 1rem;
		font-weight: bold;
		margin: 0 0 8px;
	}
	.published-topic-item__published-at {
		font-size: var(--svelte-ui-font-size-sm);
		color: #757575;
	}
</style>
