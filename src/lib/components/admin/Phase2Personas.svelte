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

	interface Persona {
		id: string;
		name: string;
		age: number;
		occupation: string;
		stakeholderRole: string;
		stanceDirection: string;
		background: string;
	}

	let personas = $state<Persona[]>([]);
	let loading = $state(true);
	let error = $state('');

	async function load() {
		try {
			const data = (await api.getPersonas(topicId)) as Persona[];
			if (data.length > 0) {
				personas = data;
				loading = false;
				return;
			}
		} catch {
			/* データ未存在 */
		}
		try {
			await api.generatePersonas(topicId);
			personas = (await api.getPersonas(topicId)) as Persona[];
		} catch (e) {
			error = e instanceof Error ? e.message : '処理に失敗しました';
		} finally {
			loading = false;
		}
	}

	async function handleBack() {
		error = '';
		try {
			await api.resetToPhase1(topicId);
		} catch (e) {
			error = e instanceof Error ? e.message : '操作に失敗しました';
		}
	}

	async function handleApprove() {
		loading = true;
		error = '';
		try {
			await api.approvePersonas(topicId);
		} catch (e) {
			error = e instanceof Error ? e.message : '操作に失敗しました';
			loading = false;
		}
	}

	onMount(() => {
		progressStore.start();
		load();
		return () => progressStore.stop();
	});
</script>

<section>
	<h2>フェーズ 2: ペルソナ生成</h2>
	<p class="topic">{topicTitle}</p>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if loading}
		<p class="step" role="status">{progressStore.progress?.currentStep ?? '処理中...'}</p>
	{:else if !error || personas.length > 0}
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
		{#if !loading && personas.length > 0}
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
