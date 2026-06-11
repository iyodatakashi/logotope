<script lang="ts">
	import { onMount } from 'svelte';
	import { updateDoc, doc, Timestamp } from 'firebase/firestore';
	import { db } from '$lib/firebase.js';
	import { createTopicStore } from '$lib/stores/topic.svelte.js';
	import { generateStakeholders } from '$lib/api/topics.js';

	interface Props {
		topicId: string;
		topicTitle: string;
	}
	let { topicId, topicTitle }: Props = $props();

	const topicStore = createTopicStore(topicId);

	let generating = $state(false);
	let error = $state('');

	const stakeholders = $derived(topicStore.topic?.stakeholders?.items ?? []);
	const isRunning = $derived(generating);
	const isStopped = $derived(!!error && !generating);

	async function doGenerate() {
		generating = true;
		error = '';
		try {
			const { stakeholders: items } = await generateStakeholders(topicTitle);
			await updateDoc(doc(db, 'topics', topicId), {
				stakeholders: { items, approved: false, createdAt: Timestamp.now() },
				updatedAt: Timestamp.now()
			});
		} catch (e) {
			error = e instanceof Error ? e.message : '処理に失敗しました';
		} finally {
			generating = false;
		}
	}

	async function handleApprove() {
		try {
			await topicStore.approveStakeholders();
		} catch (e) {
			error = e instanceof Error ? e.message : '操作に失敗しました';
		}
	}

	onMount(() => {
		topicStore.start();
		return () => topicStore.stop();
	});
</script>

<section>
	<h2>フェーズ 1: ステークホルダー調査</h2>
	<p class="topic">{topicTitle}</p>

	{#if isStopped}
		<p class="status-stopped" role="alert">処理停止: {error}</p>
	{:else if isRunning}
		<p class="step" role="status">分析中...</p>
	{/if}

	{#if stakeholders.length > 0}
		<ul class="list">
			{#each stakeholders as s, i (i)}
				<li class="item">
					<div class="item-header">
						<strong>{s.role}</strong>
						<span class="badge">{s.stanceDirection}</span>
						<span class="minor">マイノリティ度: {s.minorityLevel}</span>
					</div>
					<p class="rationale">{s.reason}</p>
				</li>
			{/each}
		</ul>
		{#if !isRunning && !isStopped}
			<div class="actions">
				<button class="primary" onclick={handleApprove}>次のフェーズへ進む</button>
			</div>
		{/if}
	{:else if !isRunning}
		<div class="actions">
			<button class="primary" onclick={doGenerate}>調査を開始する</button>
		</div>
	{/if}
</section>

<style>
	section { padding: 16px; }
	.topic { color: #555; margin-bottom: 16px; }
	.step { color: #1565c0; font-style: italic; }
	.status-stopped { color: #e65100; font-weight: 600; }
	.list { list-style: none; padding: 0; }
	.item { padding: 12px; border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 8px; }
	.item-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.badge { padding: 2px 8px; background: #e3f2fd; border-radius: 12px; font-size: 0.875rem; }
	.minor { color: #757575; font-size: 0.875rem; }
	.rationale { color: #555; margin-top: 6px; font-size: 0.875rem; }
	.actions { margin-top: 16px; display: flex; gap: 8px; }
	.primary { padding: 10px 24px; background: #1565c0; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
	.primary:hover { background: #0d47a1; }
</style>
