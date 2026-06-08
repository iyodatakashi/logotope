<script lang="ts">
	import type { ProgressState } from '$lib/types/index.js';

	interface Props {
		progress: ProgressState | null;
	}

	let { progress }: Props = $props();

	const percent = $derived(
		progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0
	);
</script>

<div class="progress-panel">
	{#if !progress}
		<p>進捗を取得中...</p>
	{:else}
		<div class="status-row">
			<span class="step">{progress.currentStep || progress.status}</span>
			<span class="count">{progress.completed} / {progress.total}</span>
		</div>
		<div class="progress-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
			<div class="progress-fill" style="width: {percent}%"></div>
		</div>
	{/if}
</div>

<style>
	.progress-panel { padding: 16px; }
	.status-row { display: flex; justify-content: space-between; margin-bottom: 8px; }
	.step { font-weight: 500; }
	.count { color: #757575; font-size: 0.875rem; }
	.progress-bar { height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden; margin-bottom: 8px; }
	.progress-fill { height: 100%; background: #1565c0; transition: width 0.3s ease; }
</style>
