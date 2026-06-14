<script lang="ts">
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
	import { phaseActions } from '$lib/models/topic/phaseActions.js';
	import { phaseLogicalState } from '$lib/utils/phase.js';
	import { engagementStyle } from '$lib/utils/engagement.js';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';

	const PHASE = 1;
	const logicalState = $derived.by(() => {
		const topic = currentTopicStore.topic;
		return topic
			? phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE)
			: 'not_started';
	});
	const stakeholders = $derived(currentTopicStore.topic?.stakeholders?.items ?? []);
</script>

<PhasePanel
	phase={PHASE}
	{logicalState}
	title="フェーズ 1: ステークホルダー調査"
	onGenerate={() => void phaseActions.generate(PHASE)}
	onApprove={() => void phaseActions.approve(PHASE)}
	onRegenerate={() => void phaseActions.regenerate(PHASE)}
	onRetry={() => void phaseActions.retry(PHASE)}
>
	{#snippet content()}
		{#if stakeholders.length > 0}
			<ul class="list">
				{#each stakeholders as s, i (i)}
					<li class="item">
						<div class="item-header">
							<strong>{s.role}</strong>
							<span class="badge">{s.stanceDirection}</span>
							<span
								class="engagement"
								style:color={engagementStyle(s.engagementLevel).color}
								style:background={engagementStyle(s.engagementLevel).bg}
							>
								{engagementStyle(s.engagementLevel).label}
							</span>
							<span class="minor">マイノリティ度: {s.minorityLevel}</span>
						</div>
						<p class="rationale">{s.reason}</p>
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
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.badge {
		padding: 2px 8px;
		background: #e3f2fd;
		border-radius: 12px;
		font-size: 0.875rem;
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
