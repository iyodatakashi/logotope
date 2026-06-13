<script lang="ts">
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
	import { createPhaseController } from '$lib/models/topic/phaseController.svelte.js';
	import { engagementStyle } from '$lib/utils/engagement.js';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';

	const controller = createPhaseController(2);
	const personas = $derived(currentTopicStore.personasStore.personas);
</script>

<PhasePanel {controller} title="フェーズ 2: ペルソナ生成">
	{#snippet content()}
		{#if personas.length > 0}
			<ul class="list">
				{#each personas as p (p.id)}
					<li class="item">
						<div class="item-header">
							<strong>{p.name}</strong>
							<span class="age">{p.age}歳 / {p.occupation}</span>
						</div>
						<div class="meta">
							<span class="badge">{p.stakeholderRole}</span>
							<span class="stance">{p.stanceDirection}</span>
							<span
								class="engagement"
								style:color={engagementStyle(p.engagementLevel).color}
								style:background={engagementStyle(p.engagementLevel).bg}
							>
								{engagementStyle(p.engagementLevel).label}
							</span>
						</div>
						<p class="bg">{p.background}</p>
					</li>
				{/each}
			</ul>
		{/if}
	{/snippet}
</PhasePanel>

<style>
	.list {
		list-style: none;
		padding: 0;
	}
	.item {
		padding: 12px;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		margin-bottom: 8px;
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
	.stance {
		color: #555;
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
