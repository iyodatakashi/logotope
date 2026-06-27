<script lang="ts">
	import type { Persona } from '$lib/models/persona/persona.types';
	import { engagementStyle } from '$lib/models/engagement/engagement.constants';

	let { persona }: { persona: Persona } = $props();
</script>

<li class="item">
	<div class="item-header">
		<strong>{persona.name}</strong>
		<span class="age">{persona.age}歳</span>
		<span class="id">{persona.id}</span>
	</div>
	<div class="meta">
		<span class="badge">{persona.specificRole ?? persona.stakeholderRole}</span>
		{#if persona.occupation && persona.occupation !== (persona.specificRole ?? persona.stakeholderRole)}
			<span class="occupation">{persona.occupation}</span>
		{/if}
		<span
			class="engagement"
			style:color={engagementStyle(persona.engagementLevel).color}
			style:background={engagementStyle(persona.engagementLevel).bg}
		>
			{engagementStyle(persona.engagementLevel).label}
		</span>
	</div>
	<p class="bg">{persona.background}</p>
</li>

<style>
	.item {
		padding: 16px;
		background-color: var(--white);
		border: 1px solid var(--svelte-ui-border-weak-color);
		border-radius: 4px;
	}
	.item-header {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.age {
		color: #757575;
		font-size: 0.875rem;
	}
	.id {
		margin-left: auto;
		color: #9e9e9e;
		font-size: 0.75rem;
		font-family: monospace;
		user-select: all;
	}
	.meta {
		margin-top: 4px;
		display: flex;
		gap: 8px;
	}
	.badge {
		padding: 2px 8px;
		background: #e3f2fd;
		border-radius: 12px;
		font-size: 0.875rem;
	}
	.occupation {
		color: #757575;
		font-size: 0.875rem;
	}
	.engagement {
		padding: 2px 8px;
		border-radius: 12px;
		font-size: 0.875rem;
		font-weight: 600;
	}
	.bg {
		color: #555;
		margin-top: 6px;
		font-size: 0.875rem;
	}
</style>
