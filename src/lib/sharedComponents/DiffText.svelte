<script lang="ts">
	import type { InlineDiffSegment } from '$lib/utils/inlineDiff';

	let { segments }: { segments: InlineDiffSegment[] } = $props();
</script>

<span class="diff-text">
	{#each segments as segment, i (i)}
		{#if segment.type === 'equal'}<span>{segment.text}</span>
		{:else if segment.type === 'insert'}<ins>{segment.text}</ins>
		{:else}<del>{segment.text}</del>{/if}
	{/each}
</span>

<style>
	.diff-text {
	}
	ins {
		background: #e6ffed;
		color: #22863a;
		text-decoration: none;
		border-radius: 2px;
	}
	del {
		background: #ffeef0;
		color: #b31d28;
		text-decoration: line-through;
		border-radius: 2px;
	}
</style>
