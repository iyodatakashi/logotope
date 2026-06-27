<script lang="ts">
	import type { Persona } from '$lib/models/persona/persona.types';
	import { engagementStyle } from '$lib/models/engagement/engagement.constants';

	let { persona }: { persona: Persona } = $props();
</script>

<li class="persona-item">
	<div class="persona-item__header">
		<span class="persona-item__name">{persona.name}</span>
		<span class="persona-item__age">{persona.age}歳</span>
		<span class="persona-item__badge">{persona.specificRole ?? persona.stakeholderRole}</span>
	</div>

	<div class="persona-item__meta">
		{#if persona.occupation && persona.occupation !== (persona.specificRole ?? persona.stakeholderRole)}
			<span class="persona-item__occupation">{persona.occupation}</span>
		{/if}
		<span
			class="persona-item__engagement"
			style:color={engagementStyle(persona.engagementLevel).color}
			style:background={engagementStyle(persona.engagementLevel).bg}
		>
			{engagementStyle(persona.engagementLevel).label}
		</span>
	</div>

	<div class="persona-item__bg">{persona.background}</div>
</li>

<style>
	.persona-item {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px;
		background-color: var(--white);
		border: 1px solid var(--svelte-ui-border-weak-color);
		border-radius: 4px;
	}

	.persona-item__header {
		display: flex;
		align-items: baseline;
		gap: 8px;

		.persona-item__name {
			font-weight: bold;
		}

		.persona-item__badge::before {
			content: ' ... ';
		}
	}

	.persona-item__meta {
		display: flex;
		gap: 8px;
	}
	.persona-item__occupation {
		font-size: var(--svelte-ui-font-size-sm);
	}
	.persona-item__engagement {
		padding: 2px 8px;
		border-radius: 999px;
		font-size: var(--svelte-ui-font-size-sm);
	}
	.persona-item__bg {
		font-size: var(--svelte-ui-font-size-sm);
	}
</style>
