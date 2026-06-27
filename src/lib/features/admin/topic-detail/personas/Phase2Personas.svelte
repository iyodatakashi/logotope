<script lang="ts">
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath } from '$lib/models/phase/phase';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import PersonaItem from './PersonaItem.svelte';

	const PHASE = 2;
	// 押下直後の楽観的な「実行中」表示用フラグ。サーバ権威のステータス書き込みには
	// 触れず、表示の即時フィードバックだけを担う。実状態(running)が反映されたら解除する。
	let isStarting = $state(false);
	const logicalState = $derived.by(() => {
		if (isStarting) return 'running';
		const topic = currentTopicStore.topic;
		return topic
			? phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE)
			: 'not_started';
	});
	$effect(() => {
		const topic = currentTopicStore.topic;
		if (
			topic &&
			phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE) === 'running'
		) {
			isStarting = false;
		}
	});
	const personas = $derived(currentTopicStore.personasStore.personas);

	const generate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await topic.generatePersonas();
		} finally {
			isStarting = false;
		}
	};

	// 再生成: ペルソナと下流（取材・章立て・討論）を破棄してから作り直す。
	// isStarting で押下直後に「実行中」表示へ切り替え、旧データを隠す（リセット完了を待たない）。
	const regenerate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await topic.resetPersonas();
			await topic.resetChapters();
			await topic.resetDebate();
			await topic.generatePersonas();
		} finally {
			isStarting = false;
		}
	};

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
		description:
			'現在のペルソナと、以降のフェーズで生成済みのデータ（取材・章立て・討論）が削除されます。',
		submitLabel: '再生成する'
	}}
	onGenerate={generate}
	onApprove={approve}
	onRegenerate={regenerate}
>
	{#snippet content()}
		{#if !isStarting && personas.length > 0}
			<ul class="personas__list">
				{#each personas as persona (persona.id)}
					<PersonaItem {persona} />
				{/each}
			</ul>
		{/if}
	{/snippet}
</PhasePanel>

<style>
	.personas__list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
</style>
