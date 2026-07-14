<script lang="ts">
	import type { Snippet } from 'svelte';

	// フェーズ画面のレイアウトの器。sticky な操作ペインとスクロールするコンテンツペインだけを提供する。
	// 操作ボタン群・注記・確認ダイアログは画面固有のため、各画面が actions snippet に直接書く（一元管理しない）。
	interface Props {
		actions?: Snippet; // 操作ペインの中身（ボタン群・注記など）
		content?: Snippet; // コンテンツ本体
		progress?: Snippet; // コンテンツ先頭に置く進捗表示
	}

	let { actions, content, progress }: Props = $props();
</script>

<div class="phase-panel">
	{#if actions}
		<div class="phase-panel__actions-pane">
			<div class="phase-panel__actions-content">
				{@render actions()}
			</div>
		</div>
	{/if}

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

<style>
	.phase-panel {
		height: 100%;
		overflow: auto;
	}

	.phase-panel__actions-pane {
		position: sticky;
		top: 0;
		padding: 24px;
		background-color: color-mix(in srgb, var(--base-100) 50%, transparent);
		backdrop-filter: blur(6px);
		z-index: 100;
	}

	.phase-panel__actions-content {
		max-width: 960px;
		margin: 0 auto;
	}

	.phase-panel__contents-pane {
		padding: 0 24px 24px;
	}

	.phase-panel__progress {
		margin-bottom: 12px;
	}
</style>
