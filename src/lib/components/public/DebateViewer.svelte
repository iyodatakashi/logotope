<script lang="ts">
	import type { PublishedDebateDetail } from '$lib/types/index.js';
	import TurnDisplay from './TurnDisplay.svelte';
	import PersonaFilter from './PersonaFilter.svelte';
	import BeliefEvolution from './BeliefEvolution.svelte';

	interface Props {
		debate: PublishedDebateDetail;
		selectedPersonaId?: string | null;
	}

	let { debate, selectedPersonaId = $bindable(null) }: Props = $props();

	const filteredTurns = $derived(
		selectedPersonaId
			? debate.turns.filter(
					(t) =>
						t.speakerType === 'persona' &&
						t.speakerName === debate.personas.find((p) => p.id === selectedPersonaId)?.name
				)
			: debate.turns
	);
</script>

<div class="viewer">
	<div class="sidebar">
		<PersonaFilter
			personas={debate.personas}
			bind:selectedPersonaId
		/>
		{#if selectedPersonaId}
			{@const persona = debate.personas.find((p) => p.id === selectedPersonaId)}
			{#if persona}
				<BeliefEvolution {persona} turns={debate.turns} />
			{/if}
		{/if}
	</div>

	<div class="turns">
		{#each filteredTurns as turn (turn.id)}
			<TurnDisplay {turn} />
		{/each}
	</div>
</div>

<style>
	.viewer {
		display: grid;
		grid-template-columns: 240px 1fr;
		gap: 24px;
		align-items: start;
	}
	@media (max-width: 640px) {
		.viewer {
			grid-template-columns: 1fr;
		}
	}
	.sidebar {
		position: sticky;
		top: 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.turns {
		min-width: 0;
	}
</style>
