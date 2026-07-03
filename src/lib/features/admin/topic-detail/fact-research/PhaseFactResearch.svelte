<script lang="ts">
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath, nextPhase } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import type { FactItem } from '$lib/models/factBase/factBase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import { Button, Input, Textarea, Skeleton } from '@14ch/svelte-ui';

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

	// 再実行: 承認前の事実基盤を作り直す（同経路で上書き再生成）。
	const regenerate = generate;

	// 編集内容を factBase/0 に保存する（生成基準日は保持）。
	const save = async () => {
		const data = currentTopicStore.factBaseStore.data;
		if (!data) return;
		await currentTopicStore.factBaseStore.save({
			facts: $state.snapshot(draftFacts),
			generatedAt: data.generatedAt
		});
	};

	const addSource = (factIndex: number) => {
		draftFacts[factIndex].sources.push({ title: '', url: '' });
	};
	const removeSource = (factIndex: number, sourceIndex: number) => {
		draftFacts[factIndex].sources.splice(sourceIndex, 1);
	};
	const removeFact = (factIndex: number) => {
		draftFacts.splice(factIndex, 1);
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
		description: '現在の事実基盤が作り直されます。',
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
			<ul class="fact-list">
				{#each draftFacts as fact, factIndex (factIndex)}
					<li class="fact-item">
						<Textarea
							value={fact.statement}
							oninput={(v) => (draftFacts[factIndex].statement = v)}
							rows={2}
							fullWidth
						/>
						<div class="fact-item__sources">
							{#each fact.sources as source, sourceIndex (sourceIndex)}
								<div class="fact-item__source">
									<Input
										value={source.title}
										oninput={(v) => (draftFacts[factIndex].sources[sourceIndex].title = String(v))}
										placeholder="出典（媒体名など）"
										fullWidth
									/>
									<Input
										value={source.url}
										oninput={(v) => (draftFacts[factIndex].sources[sourceIndex].url = String(v))}
										placeholder="https://"
										fullWidth
									/>
									<Button
										type="button"
										variant="ghost"
										onclick={() => removeSource(factIndex, sourceIndex)}>削除</Button
									>
								</div>
							{/each}
							<Button type="button" variant="outlined" onclick={() => addSource(factIndex)}
								>出典を追加</Button
							>
						</div>
						<Button type="button" variant="ghost" onclick={() => removeFact(factIndex)}
							>この事実を削除</Button
						>
					</li>
				{/each}
			</ul>
			<div class="fact-list__actions">
				<Button variant="filled" onclick={save}>編集内容を保存する</Button>
			</div>
		{:else if currentTopicStore.factBaseStore.isLoaded && logicalState !== 'not_started'}
			<p class="fact-list__empty">確たる客観的事実は見つかりませんでした（事実基盤は空です）。</p>
		{/if}
	{/snippet}
</PhasePanel>

<style>
	.fact-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.fact-item {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px;
		background-color: var(--white);
		border: 1px solid var(--svelte-ui-border-weak-color);
		border-radius: 4px;
	}

	.fact-item__sources {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.fact-item__source {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.fact-list__actions {
		margin-top: 16px;
	}

	.fact-list__empty {
		color: var(--svelte-ui-text-subtle-color);
	}
</style>
