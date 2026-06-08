<script lang="ts">
	import { onMount } from 'svelte';
	import { createProgressStore } from '$lib/stores/progress.svelte.js';
	import * as api from '$lib/api/topics.js';

	interface Props {
		topicId: string;
		topicTitle: string;
	}
	let { topicId, topicTitle }: Props = $props();

	const progressStore = createProgressStore(topicId);

	interface Interview {
		personaId: string;
		personaName: string;
		interviewRecord: string;
		status: string;
	}

	let interviews = $state<Interview[]>([]);
	let loading = $state(true);
	let error = $state('');
	let expanded = $state<Set<string>>(new Set());

	function toggle(id: string) {
		expanded = new Set(expanded.has(id) ? [...expanded].filter((x) => x !== id) : [...expanded, id]);
	}

	async function load() {
		try {
			const data = (await api.getInterviews(topicId)) as Interview[];
			if (data.some((i) => i.interviewRecord !== '')) {
				interviews = data;
				loading = false;
				return;
			}
		} catch {
			/* データ未存在 */
		}
		try {
			await api.startInterviews(topicId);
			interviews = (await api.getInterviews(topicId)) as Interview[];
		} catch (e) {
			error = e instanceof Error ? e.message : '処理に失敗しました';
		} finally {
			loading = false;
		}
	}

	async function handleBack() {
		error = '';
		try {
			await api.resetToPhase2(topicId);
		} catch (e) {
			error = e instanceof Error ? e.message : '操作に失敗しました';
		}
	}

	async function handleApprove() {
		loading = true;
		error = '';
		try {
			await api.approveInterviews(topicId);
		} catch (e) {
			error = e instanceof Error ? e.message : '操作に失敗しました';
			loading = false;
		}
	}

	const completedCount = $derived(progressStore.progress?.completed ?? 0);
	const totalCount = $derived(progressStore.progress?.total ?? 0);

	onMount(() => {
		progressStore.start();
		load();
		return () => progressStore.stop();
	});
</script>

<section>
	<h2>フェーズ 3: ペルソナ取材</h2>
	<p class="topic">{topicTitle}</p>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if loading}
		<p class="step" role="status">
			{progressStore.progress?.currentStep ?? '取材中...'}
			{#if totalCount > 0}
				（{completedCount}人中{totalCount}人完了）
			{/if}
		</p>
	{:else if interviews.length > 0}
		<ul class="list">
			{#each interviews as iv (iv.personaId)}
				<li class="item">
					<button class="toggle" onclick={() => toggle(iv.personaId)}>
						<strong>{iv.personaName}</strong>
						<span class="status-badge" class:done={iv.status === 'completed'}>{iv.status}</span>
						<span class="arrow">{expanded.has(iv.personaId) ? '▲' : '▼'}</span>
					</button>
					{#if expanded.has(iv.personaId)}
						<pre class="record">{iv.interviewRecord}</pre>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<div class="actions">
		<button class="secondary" onclick={handleBack}>前のフェーズに戻る</button>
		{#if !loading && interviews.length > 0}
			<button class="primary" onclick={handleApprove}>次のフェーズへ進む</button>
		{/if}
	</div>
</section>

<style>
	section { padding: 16px; }
	.topic { color: #555; margin-bottom: 16px; }
	.step { color: #555; font-style: italic; }
	.error { color: #d32f2f; }
	.list { list-style: none; padding: 0; }
	.item { border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
	.toggle { display: flex; align-items: center; gap: 8px; width: 100%; padding: 12px; background: none; border: none; cursor: pointer; text-align: left; }
	.toggle:hover { background: #f5f5f5; }
	.status-badge { padding: 2px 8px; background: #e0e0e0; border-radius: 12px; font-size: 0.75rem; }
	.status-badge.done { background: #c8e6c9; }
	.arrow { margin-left: auto; color: #757575; }
	.record { padding: 12px; background: #fafafa; font-size: 0.875rem; white-space: pre-wrap; word-break: break-word; border-top: 1px solid #e0e0e0; }
	.actions { margin-top: 16px; display: flex; gap: 8px; }
	.primary { padding: 10px 24px; background: #1565c0; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
	.primary:hover { background: #0d47a1; }
	.secondary { padding: 10px 24px; background: none; border: 1px solid #bbb; color: #555; border-radius: 4px; cursor: pointer; font-size: 1rem; }
	.secondary:hover { border-color: #555; }
</style>
