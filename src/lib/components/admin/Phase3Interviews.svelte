<script lang="ts">
	import { onMount } from 'svelte';
	import { createPersonasStore } from '$lib/stores/personas.svelte.js';
	import { createTopicStore } from '$lib/stores/topic.svelte.js';
	import { runInterview } from '$lib/api/topics.js';

	interface Props {
		topicId: string;
		topicTitle: string;
	}
	let { topicId, topicTitle }: Props = $props();

	const personasStore = createPersonasStore(topicId);
	const topicStore = createTopicStore(topicId);

	let starting = $state(false);
	let started = $state(false);
	let error = $state('');
	let expanded = $state<Set<string>>(new Set());

	function toggle(id: string) {
		expanded = new Set(expanded.has(id) ? [...expanded].filter((x) => x !== id) : [...expanded, id]);
	}

	const interviews = $derived(
		personasStore.personas.map((p) => ({
			personaId: p.id,
			personaName: p.name,
			stakeholderRole: p.stakeholderRole,
			interviewRecord: p.interview?.interviewRecord ?? '',
			status: p.interview?.status ?? 'pending'
			// status: 'pending' | 'in_progress' | 'completed' | 'error'
		}))
	);

	const erroredPersonas = $derived(
		personasStore.personas.filter((p) => p.interview?.status === 'error')
	);
	const completedCount = $derived(
		personasStore.personas.filter((p) => p.interview?.status === 'completed').length
	);
	const errorCount = $derived(erroredPersonas.length);
	const pendingCount = $derived(
		personasStore.personas.filter((p) => p.interview == null).length
	);
	const totalCount = $derived(personasStore.personas.length);
	const allCompleted = $derived(completedCount === totalCount && totalCount > 0);

	$effect(() => {
		if (!personasStore.isLoaded || personasStore.personas.length === 0 || started) return;
		const pending = personasStore.personas.filter((p) => p.interview?.status !== 'completed');
		if (pending.length > 0) {
			void doRunPending(pending.map((p) => p.id));
		}
	});

	async function doRunPending(personaIds: string[]) {
		started = true;
		starting = true;
		error = '';
		for (const personaId of personaIds) {
			await runInterview(topicId, personaId).catch(() => undefined);
		}
		starting = false;
	}

	async function handleRetry(personaId: string) {
		await runInterview(topicId, personaId).catch((e) => {
			error = e instanceof Error ? e.message : 'リトライに失敗しました';
		});
	}

	async function handleBack() {
		error = '';
		try {
			await topicStore.resetToPhase2();
		} catch (e) {
			error = e instanceof Error ? e.message : '操作に失敗しました';
		}
	}

	async function handleApprove() {
		error = '';
		try {
			await topicStore.approveInterviews();
		} catch (e) {
			error = e instanceof Error ? e.message : '操作に失敗しました';
		}
	}

	onMount(() => {
		personasStore.start();
		topicStore.start();
		return () => {
			personasStore.stop();
			topicStore.stop();
		};
	});
</script>

<section>
	<h2>フェーズ 3: ペルソナ取材</h2>
	<p class="topic">{topicTitle}</p>

	{#if !personasStore.isLoaded}
		<p class="hint">読み込み中...</p>
	{:else if totalCount > 0}
		<div class="progress-summary">
			<span class="count completed">{completedCount} 完了</span>
			{#if pendingCount > 0}
				<span class="count pending">{pendingCount} 待機中</span>
			{/if}
			{#if errorCount > 0}
				<span class="count error-count">{errorCount} エラー</span>
			{/if}
			<span class="count total">/ {totalCount} 件</span>
			{#if starting}
				<span class="hint">（取材リクエスト送信中...）</span>
			{/if}
		</div>
	{/if}

	{#if interviews.length > 0}
		<ul class="list">
			{#each interviews as iv (iv.personaId)}
				<li class="item" class:item-completed={iv.status === 'completed'} class:item-error={iv.status === 'error'} class:item-pending={iv.status === 'pending'}>
					<div class="toggle-row">
						<button class="toggle" onclick={() => toggle(iv.personaId)}>
							<span class="name-role">
								<strong>{iv.personaName}</strong>
								<span class="role">{iv.stakeholderRole}</span>
							</span>
							<span class="status-badge"
								class:done={iv.status === 'completed'}
								class:active={iv.status === 'in_progress'}
								class:err={iv.status === 'error'}>
								{#if iv.status === 'completed'}完了
								{:else if iv.status === 'in_progress'}取材中
								{:else if iv.status === 'error'}エラー
								{:else}待機中{/if}
							</span>
							{#if iv.interviewRecord}
								<span class="arrow">{expanded.has(iv.personaId) ? '▲' : '▼'}</span>
							{/if}
						</button>
						{#if iv.status === 'error'}
							<button class="retry" onclick={() => void handleRetry(iv.personaId)}>
								リトライ
							</button>
						{/if}
					</div>
					{#if expanded.has(iv.personaId) && iv.interviewRecord}
						<pre class="record">{iv.interviewRecord}</pre>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<div class="actions">
		<button class="secondary" onclick={handleBack}>前のフェーズに戻る</button>
		{#if allCompleted}
			<button class="primary" onclick={handleApprove}>次のフェーズへ進む</button>
		{/if}
	</div>
</section>

<style>
	section { padding: 16px; }
	.topic { color: #555; margin-bottom: 16px; }
	.progress-summary { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; font-size: 0.95rem; }
	.count { font-weight: 600; }
	.count.completed { color: #2e7d32; }
	.count.pending { color: #1565c0; }
	.count.stopped { color: #e65100; }
	.count.error-count { color: #c62828; }
	.count.total { color: #555; font-weight: 400; }
	.step { color: #555; font-style: italic; font-size: 0.875rem; margin-bottom: 12px; }
	.hint { color: #888; font-size: 0.875rem; }
	.list { list-style: none; padding: 0; }
	.item { border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 6px; overflow: hidden; }
	.item-completed { border-color: #a5d6a7; background: #f9fff9; }
	.item-error { border-color: #ef9a9a; background: #fff9f9; }
	.item-pending { border-color: #90caf9; background: #f5f9ff; }
	.toggle-row { display: flex; align-items: center; }
	.toggle { display: flex; align-items: center; gap: 8px; flex: 1; padding: 10px 12px; background: none; border: none; cursor: pointer; text-align: left; }
	.toggle:hover { background: rgba(0,0,0,0.03); }
	.status-icon { font-size: 1rem; flex-shrink: 0; }
	.name-role { display: flex; flex-direction: column; flex: 1; }
	.role { font-size: 0.75rem; color: #757575; }
	.status-badge { padding: 2px 8px; background: #e3f2fd; color: #1565c0; border-radius: 12px; font-size: 0.75rem; flex-shrink: 0; }
	.status-badge.done { background: #c8e6c9; color: #2e7d32; }
	.status-badge.active { background: #bbdefb; color: #1565c0; font-weight: 600; }
	.status-badge.err { background: #ffcdd2; color: #c62828; }
	.status-badge.stopped-badge { background: #ffe0b2; color: #e65100; }
	.retry { padding: 4px 10px; background: #fff3e0; border: 1px solid #ffb74d; border-radius: 4px; font-size: 0.75rem; cursor: pointer; margin-right: 8px; }
	.arrow { color: #757575; flex-shrink: 0; }
	.record { padding: 12px; background: #fafafa; font-size: 0.875rem; white-space: pre-wrap; word-break: break-word; border-top: 1px solid #e0e0e0; margin: 0; }
	.actions { margin-top: 16px; display: flex; gap: 8px; }
	.primary { padding: 10px 24px; background: #1565c0; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
	.primary:hover { background: #0d47a1; }
	.secondary { padding: 10px 24px; background: none; border: 1px solid #bbb; color: #555; border-radius: 4px; cursor: pointer; font-size: 1rem; }
	.secondary:hover { border-color: #555; }
</style>
