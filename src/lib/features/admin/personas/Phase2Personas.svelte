<script lang="ts">
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
	import { phaseLogicalState, phasePath } from '$lib/utils/phase.js';
	import { engagementStyle } from '$lib/utils/engagement.js';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';

	const PHASE = 2;
	const logicalState = $derived.by(() => {
		const topic = currentTopicStore.topic;
		return topic
			? phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE)
			: 'not_started';
	});
	const personas = $derived(currentTopicStore.personasStore.personas);

	// 生成・再生成・やり直しはいずれもペルソナを作り直す
	const generate = () => currentTopicStore.topic?.generatePersonas();
	const approve = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		await currentTopicStore.personasStore.approvePersonas();
		goto(phasePath(topic.id, 3));
	};
</script>

<PhasePanel
	{logicalState}
	title="フェーズ 2: ペルソナ生成"
	generateLabel="ペルソナを生成する"
	approveLabel="承認して次へ進む"
	regenerateLabel="再生成する"
	regenerateConfirm={{
		title: 'ペルソナを再生成しますか？',
		description: '現在のペルソナと、以降のフェーズで生成済みのデータ（取材・章立て・討論）が削除されます。',
		submitLabel: '再生成する'
	}}
	onGenerate={() => void generate()}
	onApprove={() => void approve()}
	onRegenerate={() => void generate()}
	onRetry={() => void generate()}
>
	{#snippet content()}
		{#if personas.length > 0}
			<ul class="list">
				{#each personas as p (p.id)}
					<li class="item">
						<div class="item-header">
							<strong>{p.name}</strong>
							<span class="age">{p.age}歳</span>
						</div>
						<div class="meta">
							<span class="badge">{p.specificRole ?? p.stakeholderRole}</span>
							{#if p.occupation && p.occupation !== (p.specificRole ?? p.stakeholderRole)}
								<span class="occupation">{p.occupation}</span>
							{/if}
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
	.occupation {
		color: #757575;
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
