<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button, ConfirmDialog } from '@14ch/svelte-ui';
	import type { PhaseController } from '$lib/models/topic/phaseController.svelte.js';
	import { PHASE_DEFS } from '$lib/utils/phase.js';

	interface Props {
		controller: PhaseController;
		title: string;
		generateHint?: string;
		content?: Snippet;
		progress?: Snippet;
	}

	let { controller, title, generateHint, content, progress }: Props = $props();

	const def = $derived(PHASE_DEFS.find((d) => d.phase === controller.phase)!);

	let regenerateDialog: ReturnType<typeof ConfirmDialog> | undefined = $state();
</script>

<section class="phase-panel">
	<h2>{title}</h2>

	{#if controller.error}
		<p class="error" role="alert">エラー: {controller.error}</p>
	{/if}

	{#if progress}
		<div class="progress">
			{@render progress()}
		</div>
	{/if}

	{#if controller.logicalState === 'not_started'}
		{#if generateHint}
			<p class="hint">{generateHint}</p>
		{/if}
		<div class="actions">
			<Button variant="filled" onclick={() => void controller.runGenerate()}>
				{def.generateLabel}
			</Button>
		</div>

	{:else if controller.logicalState === 'running'}
		<p class="indicator" role="status">実行中...</p>
		{#if def.stoppable && controller.runStop}
			<div class="actions">
				<Button variant="outlined" onclick={() => void controller.runStop?.()}>
					{def.stopLabel ?? '停止する'}
				</Button>
			</div>
		{/if}

	{:else if controller.logicalState === 'stopped'}
		<div class="actions">
			{#if def.restartable && controller.runRestart}
				<Button variant="filled" onclick={() => void controller.runRestart?.()}>
					{def.restartLabel ?? '再開する'}
				</Button>
			{/if}
			<Button variant="outlined" onclick={() => regenerateDialog?.open()}>
				{def.regenerateLabel}
			</Button>
		</div>

	{:else if controller.logicalState === 'generated'}
		<div class="actions">
			{#if def.forwardAction}
				<Button variant="filled" onclick={() => void controller.runApprove()}>
					{def.forwardAction.label}
				</Button>
			{/if}
			<Button variant="outlined" onclick={() => regenerateDialog?.open()}>
				{def.regenerateLabel}
			</Button>
		</div>

	{:else if controller.logicalState === 'approved'}
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
	onSubmit={() => void controller.runRegenerate()}
/>

<style>
	.phase-panel {
		padding: 16px;
	}
	.error {
		color: #c62828;
		font-weight: 600;
		padding: 8px 12px;
		background: #ffebee;
		border-radius: 4px;
		margin-bottom: 12px;
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
