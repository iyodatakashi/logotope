<script lang="ts">
	import { onMount } from 'svelte';
	import { addDoc, collection, Timestamp } from 'firebase/firestore';
	import { db } from '$lib/firebase.js';
	import { createPersonasStore } from '$lib/stores/personas.svelte.js';
	import { createTopicStore } from '$lib/stores/topic.svelte.js';
	import { generatePersonas } from '$lib/api/topics.js';

	interface Props {
		topicId: string;
		topicTitle: string;
		readonly?: boolean;
	}
	let { topicId, topicTitle, readonly = false }: Props = $props();

	// svelte-ignore state_referenced_locally -- ストアはマウント時の topicId に束縛する
	const personasStore = createPersonasStore(topicId);
	// svelte-ignore state_referenced_locally -- 同上
	const topicStore = createTopicStore(topicId);

	let generating = $state(false);
	let error = $state('');

	const personas = $derived(personasStore.personas);
	const isRunning = $derived(generating);
	const isStopped = $derived(!!error && !generating);

	async function doGenerate() {
		generating = true;
		error = '';
		try {
			const stakeholders = topicStore.topic?.stakeholders?.items ?? [];
			const { personas: generated } = await generatePersonas(topicTitle, stakeholders);
			await Promise.all(
				generated.map((p, i) =>
					addDoc(collection(db, 'topics', topicId, 'personas'), {
						topicId,
						sortOrder: i,
						approved: false,
						beliefs: [],
						createdAt: Timestamp.now(),
						...p
					})
				)
			);
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

	{#if !readonly}
		<div class="actions">
			{#if !isRunning && personas.length === 0}
				<button class="primary" onclick={doGenerate}>ペルソナを生成する</button>
			{:else if !isRunning && personas.length > 0}
				<button class="primary" onclick={handleApprove}>次のフェーズへ進む</button>
			{/if}
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
	.item-header { display: flex; align-items: baseline; gap: 8px; }
	.age { color: #757575; font-size: 0.875rem; }
	.meta { margin-top: 4px; display: flex; gap: 8px; }
	.badge { padding: 2px 8px; background: #e3f2fd; border-radius: 12px; font-size: 0.875rem; }
	.stance { color: #555; font-size: 0.875rem; }
	.bg { color: #555; margin-top: 6px; font-size: 0.875rem; }
	.actions { margin-top: 16px; display: flex; gap: 8px; }
	.primary { padding: 10px 24px; background: #1565c0; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
	.primary:hover { background: #0d47a1; }
</style>
