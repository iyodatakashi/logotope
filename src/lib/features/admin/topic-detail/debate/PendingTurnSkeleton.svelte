<script lang="ts">
	import type { PersonaForDisplay } from '$lib/models/persona/persona.types';
	import PostItem from '$lib/sharedComponents/PostItem.svelte';
	import { Skeleton } from '@14ch/svelte-ui';

	let { persona, status }: { persona: PersonaForDisplay | undefined; status: string } = $props();
</script>

<div class="pending-turn-skeleton">
	<PostItem {persona}>
		{#snippet content()}
			<Skeleton patterns={[{ type: 'text', lines: 3 }]} />
		{/snippet}
		{#snippet badge()}
			{status}
		{/snippet}
	</PostItem>
</div>

<style>
	.pending-turn-skeleton {
		padding: 16px;
		background: var(--white);
		border: solid 1px var(--svelte-ui-border-weak-color);
		border-radius: 4px;
	}
</style>
