<script lang="ts">
	import dayjs from 'dayjs';
	import type { PublishedTopic } from '$lib/models/published/published-topic/published-topic.types';

	interface Props {
		topic: PublishedTopic;
	}

	let { topic }: Props = $props();

	const formattedDate = $derived(dayjs(topic.publishedAt).format('YYYY年M月D日'));
</script>

<a href="/articles/{topic.id}" class="published-article-list-item">
	<h2 class="published-article-list-item__title">{topic.title}</h2>
	<span class="published-article-list-item__published-at">{formattedDate}</span>
</a>

<style>
	.published-article-list-item {
		display: block;
		border: 1px solid #e0e0e0;
		text-decoration: none;
		color: inherit;
		transition: background 0.15s;
	}
	.published-article-list-item:hover {
		background: #f5f5f5;
	}
	.published-article-list-item__title {
		font-size: 1rem;
		font-weight: bold;
		margin: 0 0 8px;
	}
</style>
