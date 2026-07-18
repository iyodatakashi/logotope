<script lang="ts">
	import PublishedArticleListPage from '$lib/features/public/article-list/PublishedArticleListPage.svelte';
	import type { PageData } from './$types';

	let {
		data
	}: {
		data: PageData;
	} = $props();
</script>

<PublishedArticleListPage {data} />
