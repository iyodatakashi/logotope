<script lang="ts">
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath, nextPhase } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import InterviewItem from '$lib/features/admin/topic-detail/interview/InterviewItem.svelte';

	const PHASE: PhaseSlug = 'interviews';
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
	const completedCount = $derived(
		currentTopicStore.personasStore.personas.filter(
			(persona) => persona.interview?.status === 'completed'
		).length
	);
	const errorCount = $derived(
		currentTopicStore.personasStore.personas.filter(
			(persona) => persona.interview?.status === 'error'
		).length
	);
	const pendingCount = $derived(
		currentTopicStore.personasStore.personas.filter((persona) => persona.interview == null).length
	);
	const totalCount = $derived(currentTopicStore.personasStore.personas.length);

	// 生成・やり直しは未完了ペルソナのみ取材。再生成は下流を破棄して全ペルソナを再取材する
	const generate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await currentTopicStore.personasStore.runInterviews(topic.title);
		} finally {
			isStarting = false;
		}
	};
	// 再取材: 取材記録と下流（章立て・討論・編集）を破棄してから全ペルソナを再取材する。
	// isStarting で押下直後に「実行中」表示へ切り替え、旧データを隠す（リセット完了を待たない）。
	// runInterviews（内部で phase を interviews に戻す）を最後に呼ぶ（resetEditing の phase 書込より後勝ち）。
	const regenerate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await topic.resetChapters();
			await topic.resetDebate();
			await topic.resetEditing();
			await currentTopicStore.personasStore.runInterviews(topic.title, true);
		} finally {
			isStarting = false;
		}
	};
	const approve = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		await topic.approveInterviews();
		const next = nextPhase(PHASE);
		if (next) goto(phasePath(topic.id, next));
	};
</script>

<PhasePanel
	{logicalState}
	title="フェーズ 3: ペルソナ取材"
	generateLabel="取材を開始する"
	approveLabel="承認して次へ進む"
	regenerateLabel="再取材する"
	regenerateConfirm={{
		title: '取材をやり直しますか？',
		description:
			'現在の取材記録と、以降のフェーズで生成済みのデータ（章立て・討論・編集）が削除されます。',
		submitLabel: '再取材する'
	}}
	onGenerate={generate}
	onApprove={approve}
	onRegenerate={regenerate}
>
	{#snippet progress()}
		{#if !isStarting && totalCount > 0}
			<div class="generate-interviews-page__progress-summary">
				<span class="generate-interviews-page__count generate-interviews-page__count--completed"
					>{completedCount} 完了</span
				>
				{#if pendingCount > 0}<span
						class="generate-interviews-page__count generate-interviews-page__count--pending"
						>{pendingCount} 待機中</span
					>{/if}
				{#if errorCount > 0}<span
						class="generate-interviews-page__count generate-interviews-page__count--error-count"
						>{errorCount} エラー</span
					>{/if}
				<span class="generate-interviews-page__count generate-interviews-page__count--total"
					>/ {totalCount} 件</span
				>
			</div>
		{/if}
	{/snippet}
	{#snippet content()}
		{#if !isStarting && currentTopicStore.personasStore.personas.length > 0}
			<ul class="generate-interviews-page__list">
				{#each currentTopicStore.personasStore.personas as persona (persona.id)}
					<InterviewItem {persona} />
				{/each}
			</ul>
		{/if}
	{/snippet}
</PhasePanel>

<style>
	.generate-interviews-page__progress-summary {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.generate-interviews-page__count {
		font-weight: 600;
	}
	.generate-interviews-page__count.generate-interviews-page__count--completed {
		color: #2e7d32;
	}
	.generate-interviews-page__count.generate-interviews-page__count--pending {
		color: #1565c0;
	}
	.generate-interviews-page__count.generate-interviews-page__count--error-count {
		color: #c62828;
	}
	.generate-interviews-page__count.generate-interviews-page__count--total {
		color: #555;
		font-weight: 400;
	}
	.generate-interviews-page__list {
		list-style: none;
		padding: 0;
	}
</style>
