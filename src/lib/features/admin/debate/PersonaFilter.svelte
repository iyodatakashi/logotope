<script lang="ts">
	import type { PersonaSummaryForViewer } from '$lib/models/persona/persona.types.js';

	interface Props {
		personas: PersonaSummaryForViewer[];
		selectedPersonaId: string | null;
		onselect?: (id: string | null) => void;
	}

	let { personas, selectedPersonaId = $bindable(null), onselect }: Props = $props();

	function select(id: string | null) {
		selectedPersonaId = id;
		onselect?.(id);
	}
</script>

<div class="filter">
	<p class="label">ペルソナフィルター</p>
	<div class="buttons">
		<button
			class="filter-btn"
			aria-pressed={selectedPersonaId === null}
			onclick={() => select(null)}
		>
			全員
		</button>
		{#each personas as persona (persona.id)}
			<button
				class="filter-btn"
				aria-pressed={selectedPersonaId === persona.id}
				onclick={() => select(persona.id)}
			>
				{persona.name}
			</button>
		{/each}
	</div>
</div>

<style>
	.filter {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 12px;
	}
	.label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #555;
		margin: 0 0 8px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.buttons {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.filter-btn {
		padding: 6px 10px;
		border: 1px solid #e0e0e0;
		border-radius: 6px;
		background: white;
		cursor: pointer;
		text-align: left;
		font-size: 0.875rem;
		transition: background 0.15s;
	}
	.filter-btn:hover {
		background: #f5f5f5;
	}
	.filter-btn[aria-pressed='true'] {
		background: #1565c0;
		color: white;
		border-color: #1565c0;
	}
</style>
