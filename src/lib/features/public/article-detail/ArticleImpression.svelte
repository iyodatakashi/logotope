<script lang="ts">
	import type { PublishedImpression } from '$lib/models/published/published-article.types';

	interface Props {
		impression: PublishedImpression;
	}
	let { impression }: Props = $props();
</script>

<div class="article-impression">
	<div class="article-impression__speaker">
		<span class="article-impression__name">{impression.speakerName}</span>
		{#if impression.speakerRole}
			<span class="article-impression__role">（{impression.speakerRole}）</span>
		{/if}
	</div>
	<p class="article-impression__content">{impression.content}</p>
</div>

<style>
	.article-impression {
		padding: 12px 0;
	}
	.article-impression__speaker {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 4px;
	}
	.article-impression__name {
		font-weight: bold;
	}
	.article-impression__role {
		font-size: var(--svelte-ui-font-size-sm);
		color: #757575;
	}
	.article-impression__content {
		margin: 0;
		line-height: 1.7;
		white-space: pre-wrap;
	}
</style>
