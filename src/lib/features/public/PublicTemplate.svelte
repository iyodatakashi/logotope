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

<div class="admin-topic-detail-template">
	{#if actions}
		<div class="admin-topic-detail-template__actions-pane">
			<div class="admin-topic-detail-template__actions-content">
				{@render actions()}
			</div>
		</div>
	{/if}

	<div class="admin-topic-detail-template__contents-pane">
		{#if progress}
			<div class="admin-topic-detail-template__progress">
				{@render progress()}
			</div>
		{/if}

		{#if content}
			{@render content()}
		{/if}
	</div>
</div>

<style>
	.admin-topic-detail-template {
		height: 100%;
		overflow: auto;
	}

	.admin-topic-detail-template__actions-pane {
		position: sticky;
		top: 0;
		padding: 24px;
		background-color: color-mix(in srgb, var(--base-50) 50%, transparent);
		backdrop-filter: blur(6px);
		z-index: 100;
	}

	.admin-topic-detail-template__actions-content {
		max-width: 960px;
		margin: 0 auto;
	}

	.admin-topic-detail-template__contents-pane {
		padding: 0 24px 24px;
	}

	.admin-topic-detail-template__progress {
		margin-bottom: 12px;
	}
</style>
