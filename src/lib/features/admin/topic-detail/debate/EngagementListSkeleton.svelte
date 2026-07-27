<script lang="ts">
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { Skeleton } from '@14ch/svelte-ui';

	interface Props {
		speakerPersonaId?: string | null; // このターンの話者（自身は反応しないため枠から除く）
	}

	let { speakerPersonaId = null }: Props = $props();

	// 評価中は engagements が未永続のため、反応する人数（＝話者以外の全ペルソナ）から枠数を算出する。
	const reactorIds = $derived(
		currentTopicStore.personasStore.personas
			.map((persona) => persona.id)
			.filter((personaId) => personaId !== speakerPersonaId)
	);
</script>

{#if reactorIds.length > 0}
	<div class="engagement-list-skeleton" data-testid="engagement-skeleton">
		{#each reactorIds as personaId (personaId)}
			<div class="engagement-list-skeleton__item">
				<Skeleton patterns={[{ type: 'text' }]} />
			</div>
		{/each}
	</div>
{/if}

<style>
	.engagement-list-skeleton {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 8px;
		margin-top: 6px;
		font-size: var(--svelte-ui-font-size-sm);
	}

	.engagement-list-skeleton__item {
		width: 140px;
	}
</style>
