<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';

	interface Props {
		topicId: string;
		topicTitle: string;
	}
	let { topicId, topicTitle }: Props = $props();

	const personasStore = $derived(currentTopicStore.personasStore);

	let generating = $state(false);
	let error = $state('');

	const personas = $derived(personasStore.personas);
	const isRunning = $derived(generating);
	const isStopped = $derived(!!error && !generating);

	async function doGenerate() {
		generating = true;
		error = '';
		try {
			await currentTopicStore.topic?.generatePersonas();
		} catch (e) {
			error = e instanceof Error ? e.message : '処理に失敗しました';
		} finally {
			generating = false;
		}
	}

	async function handleApprove() {
		error = '';
		try {
			await personasStore.approvePersonas();
			goto(`/admin/topics/${topicId}/interviews`);
		} catch (e) {
			error = e instanceof Error ? e.message : '操作に失敗しました';
		}
	}

</script>

<section>
	<h2>フェーズ 2: ペルソナ生成</h2>
	<p class="topic">{topicTitle}</p>

	{#if isStopped}
		<p class="status-stopped" role="alert">⛔ 処理停止 — {error}</p>
	{:else if isRunning}
		<p class="step" role="status">ペルソナ生成中...</p>
	{/if}

	{#if personas.length > 0}
		<ul class="list">
			{#each personas as p (p.id)}
				<li class="item">
					<div class="item-header">
						<strong>{p.name}</strong>
						<span class="age">{p.age}歳 / {p.occupation}</span>
					</div>
					<div class="meta">
						<span class="badge">{p.stakeholderRole}</span>
						<span class="stance">{p.stanceDirection}</span>
					</div>
					<p class="bg">{p.background}</p>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="actions">
		{#if !isRunning && personas.length === 0}
			<Button variant="filled" onclick={doGenerate}>ペルソナを生成する</Button>
		{:else if !isRunning && personas.length > 0}
			<Button variant="filled" onclick={handleApprove}>承認する</Button>
		{/if}
	</div>
</section>

<style>
	section {
		padding: 16px;
	}
	.topic {
		color: #555;
		margin-bottom: 16px;
	}
	.step {
		color: #1565c0;
		font-style: italic;
	}
	.status-stopped {
		color: #e65100;
		font-weight: 600;
	}
	.list {
		list-style: none;
		padding: 0;
	}
	.item {
		padding: 12px;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		margin-bottom: 8px;
	}
	.item-header {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.age {
		color: #757575;
		font-size: 0.875rem;
	}
	.meta {
		margin-top: 4px;
		display: flex;
		gap: 8px;
	}
	.badge {
		padding: 2px 8px;
		background: #e3f2fd;
		border-radius: 12px;
		font-size: 0.875rem;
	}
	.stance {
		color: #555;
		font-size: 0.875rem;
	}
	.bg {
		color: #555;
		margin-top: 6px;
		font-size: 0.875rem;
	}
	.actions {
		margin-top: 16px;
		display: flex;
		gap: 8px;
	}
</style>
