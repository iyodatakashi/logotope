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

	interface Stakeholder {
		id: string;
		role: string;
		stanceDirection: string;
		minorityLevel: number;
		rationale: string;
	}

	let stakeholders = $state<Stakeholder[]>([]);
	let loading = $state(true);
	let error = $state('');

	async function load() {
		try {
			const data = (await api.getStakeholders(topicId)) as Stakeholder[];
			if (data.length > 0) {
				stakeholders = data;
				loading = false;
				return;
			}
		} catch {
			/* データ未存在 */
		}
		try {
			await api.generateStakeholders(topicId);
			stakeholders = (await api.getStakeholders(topicId)) as Stakeholder[];
		} catch (e) {
			error = e instanceof Error ? e.message : '処理に失敗しました';
		} finally {
			loading = false;
		}
	}

	async function handleApprove() {
		loading = true;
		error = '';
		try {
			await api.approveStakeholders(topicId);
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
	<h2>フェーズ 1: ステークホルダー調査</h2>
	<p class="topic">{topicTitle}</p>

	{#if loading}
		<p class="step" role="status">{progressStore.progress?.currentStep ?? '処理中...'}</p>
	{:else if error}
		<p class="error" role="alert">{error}</p>
	{:else}
		<ul class="list">
			{#each stakeholders as s (s.id)}
				<li class="item">
					<div class="item-header">
						<strong>{s.role}</strong>
						<span class="badge">{s.stanceDirection}</span>
						<span class="minor">マイノリティ度: {s.minorityLevel}</span>
					</div>
					<p class="rationale">{s.rationale}</p>
				</li>
			{/each}
		</ul>
		<div class="actions">
			<button class="primary" onclick={handleApprove}>次のフェーズへ進む</button>
		</div>
	{/if}
</section>

<style>
	section { padding: 16px; }
	.topic { color: #555; margin-bottom: 16px; }
	.step { color: #555; font-style: italic; }
	.error { color: #d32f2f; }
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
