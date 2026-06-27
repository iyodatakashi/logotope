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

<div class="phase-panel">
	<div class="phase-panel__actions-pane">
		{#if logicalState === 'not_started'}
			{#if generateHint}
				<p class="hint">{generateHint}</p>
			{/if}
			<div class="phase-panel__actions">
				<Button variant="filled" onclick={onGenerate}>{generateLabel}</Button>
			</div>
		{:else if logicalState === 'running'}
			<div class="phase-panel__actions">
				{#if onStop}
					<Button variant="outlined" onclick={onStop}>{stopLabel ?? '停止する'}</Button>
				{:else}
					<Button variant="outlined" onclick={() => regenerateDialog?.open()}>
						{regenerateLabel}
					</Button>
				{/if}
			</div>
		{:else if logicalState === 'stopped'}
			<div class="phase-panel__actions">
				{#if onRestart}
					<Button variant="filled" onclick={onRestart}>{restartLabel ?? '再開する'}</Button>
				{/if}
				<Button variant="outlined" onclick={() => regenerateDialog?.open()}>
					{regenerateLabel}
				</Button>
			</div>
		{:else if logicalState === 'generated'}
			<div class="phase-panel__actions">
				<Button variant="outlined" onclick={() => regenerateDialog?.open()}>
					{regenerateLabel}
				</Button>
				{#if approveLabel && onApprove}
					<Button variant="filled" onclick={onApprove}>{approveLabel}</Button>
				{/if}
			</div>
		{:else if logicalState === 'approved'}
			<div class="phase-panel__actions">
				<Button variant="outlined" onclick={() => regenerateDialog?.open()}>
					{regenerateLabel}
				</Button>
			</div>
		{/if}
	</div>

	<div class="phase-panel__contents-pane">
		{#if progress}
			<div class="phase-panel__progress">
				{@render progress()}
			</div>
		{/if}

		{#if content}
			{@render content()}
		{/if}
	</div>
</div>

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
		display: grid;
		grid-template-rows: auto 1fr;
		height: 100%;
		overflow: hidden;
	}

	.phase-panel__actions-pane {
		padding: 24px;
	}

	.phase-panel__contents-pane {
		padding: 0 24px 24px;
		overflow: auto;
	}

	.hint {
		color: #555;
		font-size: 0.9rem;
		margin-bottom: 8px;
	}
	.phase-panel__actions {
		display: flex;
		gap: 8px;
	}
	.phase-panel__progress {
		margin-bottom: 12px;
	}
</style>
