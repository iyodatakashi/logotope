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
		emptyApproveLabel?: string; // not_started での「実行せず承認」（事実リサーチのみ・実行任意）
		onEmptyApprove?: () => void;
		stopLabel?: string; // running 中の停止（フェーズ5）
		onStop?: () => void;
		restartLabel?: string; // stopped からの再開（フェーズ5）
		onRestart?: () => void;
		content?: Snippet;
		progress?: Snippet;
		headerControls?: Snippet; // ヘッダー（アクション行）に置く画面固有の操作（例: 表示オプションのトグル）
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
		emptyApproveLabel,
		onEmptyApprove,
		stopLabel,
		onStop,
		restartLabel,
		onRestart,
		content,
		progress,
		headerControls
	}: Props = $props();

	let regenerateDialog: ReturnType<typeof ConfirmDialog> | undefined = $state();
</script>

<div class="phase-panel">
	<div class="phase-panel__actions-pane">
		<div class="phase-panel__actions-row">
			<div class="phase-panel__actions">
				{#if logicalState === 'not_started'}
					<Button variant="filled" onclick={onGenerate}>{generateLabel}</Button>
					{#if emptyApproveLabel && onEmptyApprove}
						<Button variant="outlined" onclick={onEmptyApprove}>{emptyApproveLabel}</Button>
					{/if}
				{:else if logicalState === 'running'}
					{#if onStop}
						<Button variant="outlined" onclick={onStop}>{stopLabel ?? '停止する'}</Button>
					{:else}
						<Button variant="filled" loading onclick={onGenerate}>{generateLabel}</Button>
					{/if}
				{:else if logicalState === 'stopped'}
					{#if onRestart}
						<Button variant="filled" onclick={onRestart}>{restartLabel ?? '再開する'}</Button>
					{/if}
					<Button variant="filled" onclick={() => regenerateDialog?.open()}>
						{regenerateLabel}
					</Button>
				{:else if logicalState === 'generated'}
					<Button variant="filled" onclick={() => regenerateDialog?.open()}>
						{regenerateLabel}
					</Button>
					{#if approveLabel && onApprove}
						<Button variant="filled" onclick={onApprove}>{approveLabel}</Button>
					{/if}
				{:else if logicalState === 'approved'}
					<Button variant="filled" onclick={() => regenerateDialog?.open()}>
						{regenerateLabel}
					</Button>
				{/if}
			</div>
			{#if headerControls}
				<div class="phase-panel__header-controls">
					{@render headerControls()}
				</div>
			{/if}
		</div>
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
		height: 100%;
		overflow: auto;
	}

	.phase-panel__actions-pane {
		position: sticky;
		top: 0;
		padding: 24px;
		background-color: color-mix(in srgb, var(--base-50) 50%, transparent);
		backdrop-filter: blur(20px);
		z-index: 100;
	}

	.phase-panel__contents-pane {
		padding: 0 24px 24px;
	}

	.phase-panel__actions-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.phase-panel__actions {
		display: flex;
		gap: 8px;
	}

	.phase-panel__header-controls {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.phase-panel__progress {
		margin-bottom: 12px;
	}
</style>
