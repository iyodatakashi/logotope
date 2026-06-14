<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button, ConfirmDialog } from '@14ch/svelte-ui';
	import { PHASE_DEFS } from '$lib/utils/phase.js';
	import type { Phase, PhaseLogicalState } from '$lib/utils/phase.js';

	interface Props {
		phase: Phase;
		logicalState: PhaseLogicalState;
		title: string;
		generateHint?: string;
		onGenerate: () => void;
		onApprove: () => void;
		onRegenerate: () => void;
		onRetry: () => void; // running 固着・停止からの再実行（フェーズ1〜4の共通回復）
		onStop?: () => void; // 討論の停止（フェーズ5）
		onRestart?: () => void; // 停止した討論の再開（フェーズ5）
		content?: Snippet;
		progress?: Snippet;
	}

	let {
		phase,
		logicalState,
		title,
		generateHint,
		onGenerate,
		onApprove,
		onRegenerate,
		onRetry,
		onStop,
		onRestart,
		content,
		progress
	}: Props = $props();

	const def = $derived(PHASE_DEFS.find((d) => d.phase === phase)!);

	let regenerateDialog: ReturnType<typeof ConfirmDialog> | undefined = $state();
</script>

<section class="phase-panel">
	<h2>{title}</h2>

	{#if progress}
		<div class="progress">
			{@render progress()}
		</div>
	{/if}

	{#if logicalState === 'not_started'}
		{#if generateHint}
			<p class="hint">{generateHint}</p>
		{/if}
		<div class="actions">
			<Button variant="filled" onclick={onGenerate}>
				{def.generateLabel}
			</Button>
		</div>

	{:else if logicalState === 'running'}
		<p class="indicator" role="status">実行中...</p>
		<div class="actions">
			{#if def.stoppable && onStop}
				<Button variant="outlined" onclick={onStop}>
					{def.stopLabel ?? '停止する'}
				</Button>
			{:else}
				<Button variant="outlined" onclick={onRetry}>やり直す</Button>
			{/if}
		</div>

	{:else if logicalState === 'stopped'}
		<div class="actions">
			{#if def.restartable && onRestart}
				<Button variant="filled" onclick={onRestart}>
					{def.restartLabel ?? '再開する'}
				</Button>
				<Button variant="outlined" onclick={() => regenerateDialog?.open()}>
					{def.regenerateLabel}
				</Button>
			{:else}
				<Button variant="filled" onclick={onRetry}>やり直す</Button>
			{/if}
		</div>

	{:else if logicalState === 'generated'}
		<div class="actions">
			{#if def.forwardAction}
				<Button variant="filled" onclick={onApprove}>
					{def.forwardAction.label}
				</Button>
			{/if}
			<Button variant="outlined" onclick={() => regenerateDialog?.open()}>
				{def.regenerateLabel}
			</Button>
		</div>

	{:else if logicalState === 'approved'}
		<div class="actions">
			<Button variant="outlined" onclick={() => regenerateDialog?.open()}>
				{def.regenerateLabel}
			</Button>
		</div>
	{/if}

	{#if content}
		<div class="content">
			{@render content()}
		</div>
	{/if}
</section>

<ConfirmDialog
	bind:this={regenerateDialog}
	title={def.regenerateConfirm.title}
	description={def.regenerateConfirm.description}
	danger
	submitLabel={def.regenerateConfirm.submitLabel}
	cancelLabel="キャンセル"
	onSubmit={onRegenerate}
/>

<style>
	.phase-panel {
		padding: 16px;
	}
	.indicator {
		color: #1565c0;
		font-style: italic;
	}
	.hint {
		color: #555;
		font-size: 0.9rem;
		margin-bottom: 8px;
	}
	.actions {
		margin-top: 16px;
		display: flex;
		gap: 8px;
	}
	.progress {
		margin-bottom: 12px;
	}
	.content {
		margin-top: 16px;
	}
</style>
