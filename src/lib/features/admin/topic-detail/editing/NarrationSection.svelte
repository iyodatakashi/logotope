<script lang="ts">
	import { Button, Skeleton } from '@14ch/svelte-ui';
	import DiffText from '$lib/sharedComponents/DiffText.svelte';
	import { computeInlineDiff } from '$lib/utils/inlineDiff';
	import type { Narration } from '$lib/models/editorial/editorial.types';

	interface Props {
		label: string; // 「導入」/「締め」
		part: Narration; // editorial の intro/outro（{ status, draft, final }）
		showDiff: boolean;
		onRegenerate: () => void | Promise<void>; // サーバへの再生成委譲。ローディングは当要素が自持ちする
	}
	let { label, part, showDiff, onRegenerate }: Props = $props();

	// クリック→サーバが生成中を書くまでの遅延分の楽観ローディング（二重実行防止）。
	// 書き込み後は status（スケルトン）が引き継ぐため、この要素にローカルで閉じてよい。
	let regenerating = $state(false);
	const handleRegenerate = async () => {
		if (regenerating) return;
		regenerating = true;
		try {
			await onRegenerate();
		} finally {
			regenerating = false;
		}
	};

	// 表示は要素自身の進捗ステータスと内容だけで決まる（ラン全体の完了フラグに依存しない）。
	// 進行中（pending/generating/editing）は段階ラベル付きスケルトン、完了は内容から成否を算出する。
	const inProgress = $derived(part.status !== 'finished');
	const stageLabel = $derived(
		part.status === 'generating' ? '生成中' : part.status === 'editing' ? '編集中' : ''
	);
	// 完了時の成否: 編集後あり＝編集済み、原本のみ＝編集失敗、どちらも無い＝生成失敗。
	const outcome = $derived(
		part.final != null ? 'edited' : part.draft != null ? 'draft_only' : 'gen_failed'
	);
	const content = $derived(part.final ?? part.draft ?? '');
	const diff = $derived(
		part.final != null && part.draft != null ? computeInlineDiff(part.draft, part.final) : null
	);
</script>

<section class="editing-page__narration">
	<div class="editing-page__narration-header">
		<h3 class="editing-page__narration-label">{label}</h3>
		{#if inProgress}
			{#if stageLabel}
				<span class="editing-page__stage-label">{stageLabel}</span>
			{/if}
		{:else}
			{#if outcome === 'draft_only'}
				<span class="editing-page__element-status" data-status="draft_only">編集失敗</span>
			{:else if outcome === 'gen_failed'}
				<span class="editing-page__element-status" data-status="gen_failed">生成失敗</span>
			{/if}
			<Button variant="outlined" onclick={handleRegenerate} loading={regenerating}>再生成</Button>
		{/if}
	</div>
	{#if inProgress}
		<Skeleton patterns={[{ type: 'text', lines: 3 }]} />
	{:else if outcome === 'gen_failed'}
		<!-- 生成失敗は本文を表示しない -->
	{:else if showDiff && diff}
		<p class="editing-page__narration-body"><DiffText segments={diff} /></p>
	{:else}
		<p class="editing-page__narration-body">{content}</p>
	{/if}
</section>

<style>
	.editing-page__narration {
		border-radius: 4px;
	}
	.editing-page__narration-header {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.editing-page__narration-label {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 700;
		color: #7b1fa2;
	}
	.editing-page__narration-body {
		margin: 0;
		line-height: 1.7;
		white-space: pre-wrap;
	}
	.editing-page__stage-label {
		font-size: 0.75rem;
		padding: 1px 6px;
		border-radius: 3px;
		background: #ede7f6;
		color: #5e35b1;
	}
	.editing-page__element-status {
		font-size: 0.75rem;
		padding: 1px 6px;
		border-radius: 3px;
		background: #ffebee;
		color: #c62828;
	}
	.editing-page__element-status[data-status='draft_only'] {
		background: #fff8e1;
		color: #f57f17;
	}
</style>
