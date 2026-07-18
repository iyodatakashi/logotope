<script lang="ts">
	import PublishedArticleDetailPage from '$lib/features/public/article-detail/PublishedArticleDetailPage.svelte';
	import type { PageData } from './$types';

	let {
		data
	}: {
		data: PageData;
	} = $props();
</script>

<PublishedArticleDetailPage {data} />
