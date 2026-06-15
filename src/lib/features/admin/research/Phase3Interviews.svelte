<script lang="ts">
	import { Button } from '@14ch/svelte-ui';
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
	import { phaseLogicalState, phasePath } from '$lib/models/phase/phase.js';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';

	const PHASE = 3;
	const logicalState = $derived.by(() => {
		const topic = currentTopicStore.topic;
		return topic
			? phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE)
			: 'not_started';
	});
	const personasStore = $derived(currentTopicStore.personasStore);

	let expanded = $state<Set<string>>(new Set());

	const toggle = (id: string) => {
		expanded = new Set(
			expanded.has(id) ? [...expanded].filter((x) => x !== id) : [...expanded, id]
		);
	};

	const interviews = $derived(
		personasStore.personas.map((p) => ({
			personaId: p.id,
			personaName: p.name,
			role: p.specificRole ?? p.stakeholderRole,
			researchSummary: p.interview?.researchSummary ?? '',
			interviewRecord: p.interview?.interviewRecord ?? '',
			initialBelief: p.beliefs[0]?.content ?? '',
			status: p.interview?.status ?? 'pending'
		}))
	);

	const completedCount = $derived(
		personasStore.personas.filter((p) => p.interview?.status === 'completed').length
	);
	const errorCount = $derived(
		personasStore.personas.filter((p) => p.interview?.status === 'error').length
	);
	const pendingCount = $derived(personasStore.personas.filter((p) => p.interview == null).length);
	const totalCount = $derived(personasStore.personas.length);

	const handleRetry = async (personaId: string) => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		await personasStore.runInterview(personaId, topic.title);
		const allDone = personasStore.personas.every((p) => p.interview?.status === 'completed');
		if (allDone) {
			await personasStore.markInterviewsComplete();
		}
	};

	// 生成・やり直しは未完了ペルソナのみ取材。再生成は下流を破棄して全ペルソナを再取材する
	const generate = () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		return personasStore.runInterviews(topic.title);
	};
	const regenerate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		await topic.resetChapters();
		await topic.resetDebate();
		await personasStore.runInterviews(topic.title, true);
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
		description: '現在の取材記録と、以降のフェーズで生成済みのデータ（章立て・討論）が削除されます。',
		submitLabel: '再取材する'
	}}
	onGenerate={generate}
	onApprove={approve}
	onRegenerate={regenerate}
>
	{#snippet progress()}
		{#if totalCount > 0}
			<div class="progress-summary">
				<span class="count completed">{completedCount} 完了</span>
				{#if pendingCount > 0}<span class="count pending">{pendingCount} 待機中</span>{/if}
				{#if errorCount > 0}<span class="count error-count">{errorCount} エラー</span>{/if}
				<span class="count total">/ {totalCount} 件</span>
			</div>
		{/if}
	{/snippet}
	{#snippet content()}
		{#if interviews.length > 0}
			<ul class="list">
				{#each interviews as iv (iv.personaId)}
					<li
						class="item"
						class:item-completed={iv.status === 'completed'}
						class:item-error={iv.status === 'error'}
						class:item-pending={iv.status === 'pending'}
					>
						<div class="toggle-row">
							<button class="toggle" onclick={() => toggle(iv.personaId)}>
								<span class="name-role">
									<strong>{iv.personaName}</strong>
									<span class="role">{iv.role}</span>
								</span>
								<span
									class="status-badge"
									class:done={iv.status === 'completed'}
									class:active={iv.status === 'in_progress'}
									class:err={iv.status === 'error'}
								>
									{#if iv.status === 'completed'}完了
									{:else if iv.status === 'in_progress'}取材中
									{:else if iv.status === 'error'}エラー
									{:else}待機中{/if}
								</span>
								{#if iv.initialBelief}
									<span class="arrow">{expanded.has(iv.personaId) ? '▲' : '▼'}</span>
								{/if}
							</button>
							{#if iv.status === 'error'}
								<Button variant="outlined" onclick={() => handleRetry(iv.personaId)}>
									リトライ
								</Button>
							{/if}
						</div>

						{#if expanded.has(iv.personaId) && iv.initialBelief}
							<div class="detail">
								{#if iv.researchSummary}
									<div class="section">
										<p class="section-label">リサーチ内容</p>
										<pre class="record research">{iv.researchSummary}</pre>
									</div>
								{/if}
								{#if iv.interviewRecord}
									<div class="section">
										<p class="section-label">取材記録</p>
										<pre class="record research">{iv.interviewRecord}</pre>
									</div>
								{/if}
								<div class="section">
									<p class="section-label">初期信念</p>
									<pre class="record belief">{iv.initialBelief}</pre>
								</div>
							</div>
						{/if}
					</li>
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
	.item {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		margin-bottom: 6px;
		overflow: hidden;
	}
	.item-completed {
		border-color: #a5d6a7;
		background: #f9fff9;
	}
	.item-error {
		border-color: #ef9a9a;
		background: #fff9f9;
	}
	.item-pending {
		border-color: #90caf9;
		background: #f5f9ff;
	}
	.toggle-row {
		display: flex;
		align-items: center;
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		padding: 10px 12px;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}
	.toggle:hover {
		background: rgba(0, 0, 0, 0.03);
	}
	.name-role {
		display: flex;
		flex-direction: column;
		flex: 1;
	}
	.role {
		font-size: 0.75rem;
		color: #757575;
	}
	.status-badge {
		padding: 2px 8px;
		background: #e3f2fd;
		color: #1565c0;
		border-radius: 12px;
		font-size: 0.75rem;
		flex-shrink: 0;
	}
	.status-badge.done {
		background: #c8e6c9;
		color: #2e7d32;
	}
	.status-badge.active {
		background: #bbdefb;
		color: #1565c0;
		font-weight: 600;
	}
	.status-badge.err {
		background: #ffcdd2;
		color: #c62828;
	}
	.arrow {
		color: #757575;
		flex-shrink: 0;
	}
	.detail {
		border-top: 1px solid #e0e0e0;
	}
	.section {
		padding: 10px 12px;
		border-bottom: 1px solid #f0f0f0;
	}
	.section:last-child {
		border-bottom: none;
	}
	.section-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #757575;
		margin: 0 0 6px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.record {
		font-size: 0.875rem;
		white-space: pre-wrap;
		word-break: break-word;
		margin: 0;
		background: none;
		padding: 0;
	}
	.research {
		color: #555;
	}
	.belief {
		color: #1a237e;
	}
</style>
