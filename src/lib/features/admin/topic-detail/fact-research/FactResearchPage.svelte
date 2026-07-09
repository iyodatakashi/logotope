<script lang="ts">
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath, nextPhase } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import type { FactItem } from '$lib/models/factBase/factBase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import { Skeleton } from '@14ch/svelte-ui';
	import FactResearchItem from './FactResearchItem.svelte';

	const PHASE: PhaseSlug = 'fact-research';

	// 押下直後の楽観的な「実行中」表示用フラグ（サーバ権威のステータスには触れない）。
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

	// 事実基盤の編集用ドラフト。永続データ（factBase/0）が変わるたびに同期する。
	let draftFacts = $state<FactItem[]>([]);
	$effect(() => {
		const data = currentTopicStore.factBaseStore.data;
		draftFacts = data
			? data.facts.map((fact) => ({
					statement: fact.statement,
					sources: fact.sources.map((source) => ({ ...source }))
				}))
			: [];
	});

	const generate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await topic.generateFactResearch();
		} finally {
			isStarting = false;
		}
	};

	// 再実行: 事実基盤と下流（ステークホルダー・ペルソナ・取材・章立て・討論・編集）を破棄してから作り直す。
	// 事実基盤は下流生成時に焼き込まれるため、作り直した事実を波及させるには下流を未生成へ戻す必要がある。
	// isStarting で押下直後に「実行中」表示へ切り替え、旧データを隠す（リセット完了を待たない）。
	// generateFactResearch を最後に呼ぶことで phase が fact-research へ戻る（各 reset の phase 書込より後勝ち）。
	const regenerate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await topic.resetStakeholders();
			await topic.resetPersonas();
			await topic.resetChapters();
			await topic.resetDebate();
			await topic.resetEditing();
			await topic.generateFactResearch();
		} finally {
			isStarting = false;
		}
	};

	// 編集内容を factBase/0 に保存する（生成基準日は保持）。
	const save = async () => {
		const data = currentTopicStore.factBaseStore.data;
		if (!data) return;
		await currentTopicStore.factBaseStore.save({
			facts: $state.snapshot(draftFacts),
			generatedAt: data.generatedAt
		});
	};

	// 出典は grounding が自動収集した URL。表示のみで手編集はしない（是正は事実単位の削除で行う）。
	const removeFact = (factIndex: number) => {
		draftFacts.splice(factIndex, 1);
		save();
	};

	// 承認: 事実基盤を確定し次フェーズ（ステークホルダー）へ前進する。
	const approve = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		await topic.approveFactResearch();
		const next = nextPhase(PHASE);
		if (next) goto(phasePath(topic.id, next));
	};

	// 実行せず承認: 事実基盤を空のまま確定し、同じ経路で前進する（実行は任意）。
	const emptyApprove = approve;
</script>

<PhasePanel
	{logicalState}
	title="フェーズ: 事実リサーチ"
	generateLabel="事実リサーチを実行する"
	approveLabel="承認して次へ進む"
	emptyApproveLabel="実行せず承認する"
	regenerateLabel="再実行する"
	regenerateConfirm={{
		title: '事実リサーチを再実行しますか？',
		description:
			'現在の事実基盤が作り直され、以降のフェーズで生成済みのデータ（ステークホルダー・ペルソナ・取材・章立て・討論・編集）が削除されます。',
		submitLabel: '再実行する'
	}}
	onGenerate={generate}
	onApprove={approve}
	onEmptyApprove={emptyApprove}
	onRegenerate={regenerate}
>
	{#snippet content()}
		{#if logicalState === 'running'}
			<Skeleton
				patterns={[{ type: 'box', width: '100%', height: '96px' }]}
				repeat={4}
				repeatGap="8px"
			/>
		{:else if draftFacts.length > 0}
			<ul class="fact-research-page">
				{#each draftFacts as _fact, index (index)}
					<FactResearchItem
						bind:fact={draftFacts[index]}
						onchange={save}
						onRemove={() => removeFact(index)}
					/>
				{/each}
			</ul>
		{:else if currentTopicStore.factBaseStore.isLoaded && logicalState !== 'not_started'}
			<p class="fact-research-page__empty">
				確たる客観的事実は見つかりませんでした（事実基盤は空です）。
			</p>
		{/if}
	{/snippet}
</PhasePanel>

<style>
	.fact-research-page {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.fact-research-page__empty {
		color: var(--svelte-ui-text-subtle-color);
	}
</style>
