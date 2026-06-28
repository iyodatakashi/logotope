<script lang="ts">
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath } from '$lib/models/phase/phase';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import type { TopicContext } from '$lib/models/topic/topic.types';
	import InterviewItem from '$lib/features/admin/topic-detail/research/InterviewItem.svelte';

	const PHASE = 3;
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
		currentTopicStore.personasStore.personas.filter((p) => p.interview?.status === 'completed')
			.length
	);
	const errorCount = $derived(
		currentTopicStore.personasStore.personas.filter((p) => p.interview?.status === 'error').length
	);
	const pendingCount = $derived(
		currentTopicStore.personasStore.personas.filter((p) => p.interview == null).length
	);
	const totalCount = $derived(currentTopicStore.personasStore.personas.length);

	const buildTopicContext = (topic: {
		description?: string;
		fetchedSourceContents?: { content: string }[];
	}): TopicContext | undefined => {
		const description = topic.description;
		const sourceContents = topic.fetchedSourceContents?.map((fc) => fc.content);
		if (!description && !sourceContents?.length) return undefined;
		return { description, sourceContents };
	};

	// 生成・やり直しは未完了ペルソナのみ取材。再生成は下流を破棄して全ペルソナを再取材する
	const generate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		const topicContext = buildTopicContext(topic);
		isStarting = true;
		try {
			await currentTopicStore.personasStore.runInterviews(topic.title, topicContext);
		} finally {
			isStarting = false;
		}
	};
	// isStarting で押下直後に「実行中」表示へ切り替え、旧データを隠す（リセット完了を待たない）。
	const regenerate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		const topicContext = buildTopicContext(topic);
		isStarting = true;
		try {
			await topic.resetChapters();
			await topic.resetDebate();
			await currentTopicStore.personasStore.runInterviews(topic.title, topicContext, true);
		} finally {
			isStarting = false;
		}
	};
	const approve = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		await topic.approveInterviews();
		goto(phasePath(topic.id, 4));
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
			'現在の取材記録と、以降のフェーズで生成済みのデータ（章立て・討論）が削除されます。',
		submitLabel: '再取材する'
	}}
	onGenerate={generate}
	onApprove={approve}
	onRegenerate={regenerate}
>
	{#snippet progress()}
		{#if !isStarting && totalCount > 0}
			<div class="progress-summary">
				<span class="count completed">{completedCount} 完了</span>
				{#if pendingCount > 0}<span class="count pending">{pendingCount} 待機中</span>{/if}
				{#if errorCount > 0}<span class="count error-count">{errorCount} エラー</span>{/if}
				<span class="count total">/ {totalCount} 件</span>
			</div>
		{/if}
	{/snippet}
	{#snippet content()}
		{#if !isStarting && currentTopicStore.personasStore.personas.length > 0}
			<ul class="list">
				{#each currentTopicStore.personasStore.personas as persona (persona.id)}
					<InterviewItem {persona} />
				{/each}
			</ul>
		{/if}
	{/snippet}
</PhasePanel>

<style>
	.progress-summary {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 0.95rem;
	}
	.count {
		font-weight: 600;
	}
	.count.completed {
		color: #2e7d32;
	}
	.count.pending {
		color: #1565c0;
	}
	.count.error-count {
		color: #c62828;
	}
	.count.total {
		color: #555;
		font-weight: 400;
	}
	.list {
		list-style: none;
		padding: 0;
	}
</style>
