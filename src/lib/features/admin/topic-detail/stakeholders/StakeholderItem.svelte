<script lang="ts">
	import type { Stakeholder } from '$lib/models/stakeholder/stakeholder.types';
	import { engagementStyle } from '$lib/models/engagement/engagement.constants';

	let { stakeholder }: { stakeholder: Stakeholder } = $props();
</script>

<li class="item">
	<div class="item-header">
		<strong>{stakeholder.role}</strong>
		<span
			class="engagement"
			style:color={engagementStyle(stakeholder.engagementLevel).color}
			style:background={engagementStyle(stakeholder.engagementLevel).bg}
		>
			{engagementStyle(stakeholder.engagementLevel).label}
		</span>
		<span class="minor">マイノリティ度: {stakeholder.minorityLevel}</span>
	</div>
	<p class="rationale">{stakeholder.reason}</p>
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
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.engagement {
		padding: 2px 8px;
		border-radius: 12px;
		font-size: 0.875rem;
		font-weight: 600;
	}
	.minor {
		color: #757575;
		font-size: 0.875rem;
	}
	.rationale {
		color: #555;
		margin-top: 6px;
		font-size: 0.875rem;
	}
</style>
