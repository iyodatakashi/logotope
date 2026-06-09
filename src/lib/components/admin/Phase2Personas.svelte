<script lang="ts">
	import { onMount } from 'svelte';
	import { createProgressStore } from '$lib/stores/progress.svelte.js';
	import { createPersonasStore } from '$lib/stores/personas.svelte.js';
	import { createTopicStore } from '$lib/stores/topic.svelte.js';
	import { generatePersonas } from '$lib/api/topics.js';

	interface Props {
		topicId: string;
		topicTitle: string;
	}
	let { topicId, topicTitle }: Props = $props();

	const personasStore = createPersonasStore(topicId);
	const topicStore = createTopicStore(topicId);
	const progressStore = createProgressStore(topicId);

	let generating = $state(false);
	let started = $state(false);
	let error = $state('');

	const personas = $derived(personasStore.personas);
	const isRunning = $derived(generating);
	const isStopped = $derived(!!error && !generating);

	$effect(() => {
		if (personasStore.isLoaded && personas.length === 0 && !started) {
			void doGenerate();
		}
	});

	async function doGenerate() {
		started = true;
		generating = true;
		error = '';
		try {
			await generatePersonas(topicId);
		} catch (e) {
			error = e instanceof Error ? e.message : '処理に失敗しました';
		} finally {
			generating = false;
		}
	}

	async function handleBack() {
		error = '';
		try {
			await topicStore.resetToPhase1();
		} catch (e) {
			error = e instanceof Error ? e.message : '操作に失敗しました';
		}
	}

	async function handleApprove() {
		error = '';
		try {
			await personasStore.approvePersonas();
		} catch (e) {
			error = e instanceof Error ? e.message : '操作に失敗しました';
		}
	}

	onMount(() => {
		personasStore.start();
		topicStore.start();
		progressStore.start();
		return () => {
			personasStore.stop();
			topicStore.stop();
			progressStore.stop();
		};
	});
</script>

<section>
	<h2>フェーズ 2: ペルソナ生成</h2>
	<p class="topic">{topicTitle}</p>

	{#if isStopped}
		<p class="status-stopped" role="alert">⛔ 処理停止 — {error}</p>
	{:else if isRunning}
		<p class="step" role="status">{progressStore.progress?.currentStep ?? 'ペルソナ生成中...'}</p>
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
		<button class="secondary" onclick={handleBack}>前のフェーズに戻る</button>
		{#if !isRunning && personas.length > 0}
			<button class="primary" onclick={handleApprove}>次のフェーズへ進む</button>
		{/if}
	</div>
</section>

<style>
	section { padding: 16px; }
	.topic { color: #555; margin-bottom: 16px; }
	.step { color: #1565c0; font-style: italic; }
	.status-stopped { color: #e65100; font-weight: 600; }
	.list { list-style: none; padding: 0; }
	.item { padding: 12px; border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 8px; }
	.item-header { display: flex; align-items: baseline; gap: 8px; }
	.age { color: #757575; font-size: 0.875rem; }
	.meta { margin-top: 4px; display: flex; gap: 8px; }
	.badge { padding: 2px 8px; background: #e3f2fd; border-radius: 12px; font-size: 0.875rem; }
	.stance { color: #555; font-size: 0.875rem; }
	.bg { color: #555; margin-top: 6px; font-size: 0.875rem; }
	.actions { margin-top: 16px; display: flex; gap: 8px; }
	.primary { padding: 10px 24px; background: #1565c0; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
	.primary:hover { background: #0d47a1; }
	.secondary { padding: 10px 24px; background: none; border: 1px solid #bbb; color: #555; border-radius: 4px; cursor: pointer; font-size: 1rem; }
	.secondary:hover { border-color: #555; }
</style>
