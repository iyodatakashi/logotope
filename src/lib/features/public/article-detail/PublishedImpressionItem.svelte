<script lang="ts">
	import type { PublishedImpression } from '$lib/models/published/published-article.types';
	import { convertToHtml } from '$lib/utils/formatText';

	interface Props {
		impression: PublishedImpression;
	}
	let { impression }: Props = $props();
</script>

<div class="published-impression-item">
	<div class="published-impression-item__speaker">
		<span class="published-impression-item__name">{impression.speakerName}</span>
		{#if impression.speakerRole}
			<span class="published-impression-item__role">{impression.speakerRole}</span>
		{/if}
	</div>
	<p class="published-impression-item__content">{@html convertToHtml(impression.content)}</p>
</div>

<style>
	.published-impression-item {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.published-impression-item__speaker {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.published-impression-item__name {
		font-weight: bold;
	}
</style>
