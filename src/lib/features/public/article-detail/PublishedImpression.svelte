<script lang="ts">
	import type { PublishedImpression } from '$lib/models/published/published-article.types';

	interface Props {
		impression: PublishedImpression;
	}
	let { impression }: Props = $props();
</script>

<div class="published-impression">
	<div class="published-impression__speaker">
		<span class="published-impression__name">{impression.speakerName}</span>
		{#if impression.speakerRole}
			<span class="published-impression__role">（{impression.speakerRole}）</span>
		{/if}
	</div>
	<p class="published-impression__content">{impression.content}</p>
</div>

<style>
	.published-impression {
		padding: 12px 0;
	}
	.published-impression__speaker {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 4px;
	}
	.published-impression__name {
		font-weight: bold;
	}
	.published-impression__role {
		font-size: var(--svelte-ui-font-size-sm);
		color: #757575;
	}
	.published-impression__content {
		margin: 0;
		line-height: 1.7;
		white-space: pre-wrap;
	}
</style>
