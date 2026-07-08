<script lang="ts">
	import { Button, Skeleton } from '@14ch/svelte-ui';
	import DiffText from './DiffText.svelte';
	import { computeInlineDiff } from './inlineDiff';
	import type { Narration } from '$lib/models/editorial/editorial.types';

	interface Props {
		label: string; // 「導入」/「締め」
		part: Narration; // editorial の intro/outro（{ draft, final }）
		showDiff: boolean;
		isEditingFinished: boolean;
		regenerating: boolean;
		onRegenerate: () => void;
	}
	let { label, part, showDiff, isEditingFinished, regenerating, onRegenerate }: Props = $props();

	// 生成ステータスとコンテンツ: 編集後(final)優先、無ければ原本(draft)、どちらも無ければ欠落(missing)。
	const status = $derived(
		part.final != null ? 'final' : part.draft != null ? 'draft_only' : 'missing'
	);
	const content = $derived(part.final ?? part.draft ?? '');
	const diff = $derived(
		part.final != null && part.draft != null ? computeInlineDiff(part.draft, part.final) : null
	);
</script>

<section class="editing-page__narration">
	<div class="editing-page__narration-header">
		<h3 class="editing-page__narration-label">{label}</h3>
		{#if isEditingFinished && (status === 'draft_only' || status === 'missing')}
			<span class="editing-page__element-status" data-status={status}>
				{status === 'draft_only' ? '原本のみ（未編集）' : '生成に失敗'}
			</span>
			<Button variant="outlined" onclick={onRegenerate} loading={regenerating}>再生成</Button>
		{/if}
	</div>
	{#if status === 'missing'}
		<Skeleton patterns={[{ type: 'text', lines: 3 }]} />
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
