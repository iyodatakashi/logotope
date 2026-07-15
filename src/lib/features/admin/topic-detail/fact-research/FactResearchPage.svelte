<script lang="ts">
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath, nextPhase } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import type { FactItem } from '$lib/models/factBase/factBase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import { Button, ConfirmDialog, Skeleton } from '@14ch/svelte-ui';
	import FactResearchItem from './FactResearchItem.svelte';

	const PHASE: PhaseSlug = 'fact-research';

	let regenerateDialog: ReturnType<typeof ConfirmDialog> | undefined = $state();

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

	// 再実行: サーバ権威の単一操作を1回呼ぶだけ（対象フェーズ確定→自層＋全下流破棄→生成をサーバが所有する）。
	// isStarting で押下直後に「実行中」表示（スケルトン）へ切り替え、旧データを隠す（実削除の同期反映を待たない）。
	const regenerate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
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

	const handleBackClick = () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		goto(phasePath(topic.id, 'theme'));
	};

	const handleForwardClick = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		try {
			if (logicalState !== 'approved') {
				await approve();
			}
			const next = nextPhase(PHASE);
			if (next) goto(phasePath(topic.id, next));
		} catch {}
	};
</script>

<PhasePanel>
	{#snippet actions()}
		<div class="fact-research-page__actions">
			<Button variant="outlined" icon="arrow_back" rounded onclick={handleBackClick}>
				前に戻る
			</Button>
			{#if logicalState === 'not_started'}
				<Button variant="filled" rounded icon="cached" onclick={() => regenerateDialog?.open()}>
					調査を開始する
				</Button>
			{:else if logicalState === 'running'}
				<Button
					variant="ghost"
					rounded
					icon="cached"
					loading
					onclick={() => regenerateDialog?.open()}
				>
					再調査する
				</Button>
			{:else}
				<Button variant="ghost" rounded icon="cached" onclick={() => regenerateDialog?.open()}>
					再調査する
				</Button>
			{/if}
			<Button
				variant="filled"
				icon="arrow_forward"
				iconPosition="right"
				rounded
				disabled={logicalState !== 'generated' && logicalState !== 'approved'}
				onclick={handleForwardClick}
			>
				次に進む
			</Button>
		</div>
	{/snippet}

	{#snippet content()}
		<div class="fact-research-page__content">
			{#if logicalState === 'not_started'}
				調査結果はまだありません
			{:else if logicalState === 'running'}
				<Skeleton
					patterns={[{ type: 'box', width: '100%', height: '96px' }]}
					repeat={4}
					repeatGap="8px"
				/>
			{:else if draftFacts.length > 0}
				<ul class="fact-research-page__fact-list">
					{#each draftFacts as _fact, index (index)}
						<FactResearchItem
							bind:fact={draftFacts[index]}
							onchange={save}
							onRemove={() => removeFact(index)}
						/>
					{/each}
				</ul>
			{:else if currentTopicStore.factBaseStore.isLoaded}
				<p class="fact-research-page__empty">
					確たる客観的事実は見つかりませんでした（事実基盤は空です）。
				</p>
			{/if}
		</div>
	{/snippet}
</PhasePanel>

<ConfirmDialog
	bind:this={regenerateDialog}
	title="事実リサーチを再実行しますか？"
	description="現在の事実リサーチ結果が作り直され、以降のフェーズで生成済みのデータが削除されます。"
	danger
	submitLabel="再実行する"
	cancelLabel="キャンセル"
	onSubmit={regenerate}
/>

<style>
	.fact-research-page__actions {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}

	.fact-research-page__content {
		max-width: 960px;
		margin: 0 auto;
	}

	.fact-research-page__fact-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.fact-research-page__empty {
		color: var(--svelte-ui-text-subtle-color);
	}
</style>
