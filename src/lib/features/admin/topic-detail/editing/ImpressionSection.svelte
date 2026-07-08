<script lang="ts">
	import { Button } from '@14ch/svelte-ui';
	import DiffText from './DiffText.svelte';
	import { computeInlineDiff } from './inlineDiff';
	import type { Narration } from '$lib/models/editorial/editorial.types';

	interface Props {
		name: string;
		role: string;
		part: Narration; // 参加者1人分の所感（{ draft, final }）
		showDiff: boolean;
		isEditingFinished: boolean;
		regenerating: boolean;
		onRegenerate: () => void;
	}
	let { name, role, part, showDiff, isEditingFinished, regenerating, onRegenerate }: Props =
		$props();

	// 生成ステータスとコンテンツ: 編集後(final)優先、無ければ原本(draft)、どちらも無ければ欠落(missing)。
	const status = $derived(
		part.final != null ? 'final' : part.draft != null ? 'draft_only' : 'missing'
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
		{#if isEditingFinished && (status === 'draft_only' || status === 'missing')}
			<span class="editing-page__element-status" data-status={status}>
				{status === 'draft_only' ? '原本のみ（未編集）' : '生成に失敗'}
			</span>
		{/if}
	</div>
	{#if status === 'final' || status === 'draft_only'}
		{#if showDiff && diff}
			<p class="editing-page__content"><DiffText segments={diff} /></p>
		{:else}
			<p class="editing-page__content">{content}</p>
		{/if}
	{/if}
	{#if isEditingFinished && (status === 'draft_only' || status === 'missing')}
		<div class="editing-page__impression-regenerate">
			<Button variant="outlined" onclick={onRegenerate} loading={regenerating}>再生成</Button>
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
