<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button, ConfirmDialog } from '@14ch/svelte-ui';
	import type { PhaseLogicalState } from '$lib/models/phase/phase.types';

	// 表示専用。各ボタンの文言（label）と操作（on...）はいずれも親フェーズ画面から渡す。
	// label と操作を同じ場所（親）に置くことで、ボタンの意味と実体を1ファイルで追える。
	interface Props {
		logicalState: PhaseLogicalState;
		title: string;
		generateLabel: string;
		regenerateLabel: string;
		regenerateConfirm: { title: string; description: string; submitLabel: string };
		onGenerate: () => void;
		onRegenerate: () => void; // generated/approved/stopped/running(固着) からのやり直し。確認ダイアログ付き
		approveLabel?: string; // generated での前進ボタン（フェーズ5は前進なし）
		onApprove?: () => void;
		stopLabel?: string; // running 中の停止（フェーズ5）
		onStop?: () => void;
		restartLabel?: string; // stopped からの再開（フェーズ5）
		onRestart?: () => void;
		generateHint?: string;
		content?: Snippet;
		progress?: Snippet;
	}

	let {
		logicalState,
		title,
		generateLabel,
		regenerateLabel,
		regenerateConfirm,
		onGenerate,
		onRegenerate,
		approveLabel,
		onApprove,
		stopLabel,
		onStop,
		restartLabel,
		onRestart,
		generateHint,
		content,
		progress
	}: Props = $props();

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
			<Button variant="filled" onclick={onGenerate}>{generateLabel}</Button>
		</div>
	{:else if logicalState === 'running'}
		<p class="indicator" role="status">実行中...</p>
		<div class="actions">
			{#if onStop}
				<Button variant="outlined" onclick={onStop}>{stopLabel ?? '停止する'}</Button>
			{:else}
				<Button variant="outlined" onclick={() => regenerateDialog?.open()}>
					{regenerateLabel}
				</Button>
			{/if}
		</div>
	{:else if logicalState === 'stopped'}
		<div class="actions">
			{#if onRestart}
				<Button variant="filled" onclick={onRestart}>{restartLabel ?? '再開する'}</Button>
			{/if}
			<Button variant="outlined" onclick={() => regenerateDialog?.open()}>
				{regenerateLabel}
			</Button>
		</div>
	{:else if logicalState === 'generated'}
		<div class="actions">
			{#if approveLabel && onApprove}
				<Button variant="filled" onclick={onApprove}>{approveLabel}</Button>
			{/if}
			<Button variant="outlined" onclick={() => regenerateDialog?.open()}>
				{regenerateLabel}
			</Button>
		</div>
	{:else if logicalState === 'approved'}
		<div class="actions">
			<Button variant="outlined" onclick={() => regenerateDialog?.open()}>
				{regenerateLabel}
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
	title={regenerateConfirm.title}
	description={regenerateConfirm.description}
	danger
	submitLabel={regenerateConfirm.submitLabel}
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
