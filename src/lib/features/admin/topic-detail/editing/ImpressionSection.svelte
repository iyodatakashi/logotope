<script lang="ts">
	import { Button, Skeleton } from '@14ch/svelte-ui';
	import DiffText from '$lib/sharedComponents/DiffText.svelte';
	import { computeInlineDiff } from '$lib/utils/inlineDiff';
	import type { Narration } from '$lib/models/editorial/editorial.types';

	interface Props {
		name: string;
		role: string;
		part: Narration; // 参加者1人分の所感（{ status, draft, final }）
		showDiff: boolean;
		onRegenerate: () => void | Promise<void>; // サーバへの再生成委譲。ローディングは当要素が自持ちする
	}
	let { name, role, part, showDiff, onRegenerate }: Props = $props();

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

	// 導入・締めと同一の状態別表示規則（進捗ステータス＋内容だけで決める・Req 6.2）。
	const inProgress = $derived(part.status !== 'finished');
	const stageLabel = $derived(
		part.status === 'generating' ? '生成中' : part.status === 'editing' ? '編集中' : ''
	);
	const outcome = $derived(
		part.final != null ? 'edited' : part.draft != null ? 'draft_only' : 'gen_failed'
	);
	const content = $derived(part.final ?? part.draft ?? '');
	const diff = $derived(
		part.final != null && part.draft != null ? computeInlineDiff(part.draft, part.final) : null
	);
</script>

<div class="editing-page__impression">
	<div class="editing-page__speaker">
		<div class="editing-page__speaker-name">{name}</div>
		{#if role}<span class="editing-page__role">({role})</span>{/if}
		{#if inProgress}
			{#if stageLabel}<span class="editing-page__stage-label">{stageLabel}</span>{/if}
		{:else if outcome === 'draft_only'}
			<span class="editing-page__element-status" data-status="draft_only">編集失敗</span>
		{:else if outcome === 'gen_failed'}
			<span class="editing-page__element-status" data-status="gen_failed">生成失敗</span>
		{/if}
	</div>
	{#if inProgress}
		<Skeleton patterns={[{ type: 'text', lines: 2 }]} />
	{:else if outcome !== 'gen_failed'}
		{#if showDiff && diff}
			<p class="editing-page__content"><DiffText segments={diff} /></p>
		{:else}
			<p class="editing-page__content">{content}</p>
		{/if}
	{/if}
	{#if !inProgress}
		<div class="editing-page__impression-regenerate">
			<Button variant="outlined" onclick={handleRegenerate} loading={regenerating}>再生成</Button>
		</div>
	{/if}
</div>

<style>
	.editing-page__impression {
		padding: 12px;
		border-left: 4px solid #e0e0e0;
		background: #fff;
	}
	.editing-page__speaker {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
	}
	.editing-page__speaker-name {
		font-weight: bold;
	}
	.editing-page__role {
		color: #757575;
		font-size: 0.875rem;
	}
	.editing-page__content {
		margin: 0;
		line-height: 1.6;
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
	.editing-page__impression-regenerate {
		margin-top: 8px;
	}
</style>
