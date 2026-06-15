<script lang="ts">
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
	import { phaseLogicalState, phasePath } from '$lib/models/phase/phase.js';
	import { engagementStyle } from '$lib/models/engagement/engagement.constants.js';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';

	const PHASE = 1;
	const logicalState = $derived.by(() => {
		const topic = currentTopicStore.topic;
		return topic
			? phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE)
			: 'not_started';
	});
	const stakeholders = $derived(currentTopicStore.topic?.stakeholders?.items ?? []);

	const generate = () => currentTopicStore.topic?.generateStakeholders();

	// 再生成: ステークホルダーと下流（ペルソナ・章立て・討論）を破棄してから作り直す
	const regenerate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		await topic.resetStakeholders();
		await topic.resetPersonas();
		await topic.resetChapters();
		await topic.resetDebate();
		await topic.generateStakeholders();
	};

	const approve = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		await topic.approveStakeholders();
		goto(phasePath(topic.id, 2));
	};
</script>

<PhasePanel
	{logicalState}
	title="フェーズ 1: ステークホルダー調査"
	generateLabel="調査を開始する"
	approveLabel="承認して次へ進む"
	regenerateLabel="再生成する"
	regenerateConfirm={{
		title: 'ステークホルダーを再生成しますか？',
		description:
			'現在のステークホルダーと、以降のフェーズで生成済みのデータ（ペルソナ・取材・章立て・討論）が削除されます。',
		submitLabel: '再生成する'
	}}
	onGenerate={generate}
	onApprove={approve}
	onRegenerate={regenerate}
>
	{#snippet content()}
		{#if stakeholders.length > 0}
			<ul class="list">
				{#each stakeholders as s, i (i)}
					<li class="item">
						<div class="item-header">
							<strong>{s.role}</strong>
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
