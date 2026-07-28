<script lang="ts">
	import { Button, Skeleton } from '@14ch/svelte-ui';
	import DiffText from '$lib/sharedComponents/DiffText.svelte';
	import PostItem from '$lib/sharedComponents/PostItem.svelte';
	import { computeInlineDiff } from '$lib/utils/inlineDiff';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import type { Narration } from '$lib/models/editorial/editorial.types';
	import { FACILITATOR_NAME } from '$lib/models/turn/turn.constants';

	interface Props {
		personaId: string;
		part: Narration; // 参加者1人分の所感（{ status, draft, final }）
		showDiff: boolean;
		onRegenerate: () => void | Promise<void>; // サーバへの再生成委譲。ローディングは当要素が自持ちする
		editable?: boolean; // 公開中は再生成を凍結する
	}
	let { personaId, part, showDiff, onRegenerate, editable = true }: Props = $props();

	// 話者ラベルは personaId から描画時に store の解決メソッドで引く（型には畳まない・Req 3.1）。
	const persona = $derived(currentTopicStore.personasStore.getPersona(personaId));
	const name = $derived(persona?.name ?? FACILITATOR_NAME);
	const role = $derived(persona?.role ?? '');

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
	const diff = $derived(
		part.final != null && part.draft != null ? computeInlineDiff(part.draft, part.final) : null
	);
</script>

<div class="editing-impression-item">
	<PostItem {persona}>
		{#snippet content()}
			{#if inProgress}
				<Skeleton patterns={[{ type: 'text', lines: 2 }]} />
			{:else if outcome !== 'gen_failed'}
				{#if showDiff && diff}
					<p class="editing-impression-item__content"><DiffText segments={diff} /></p>
				{:else}
					<p class="editing-impression-item__content">{part.final ?? part.draft ?? ''}</p>
				{/if}
			{/if}
			{#if !inProgress}
				<div class="editing-impression-item__regenerate">
					<Button
						variant="outlined"
						onclick={handleRegenerate}
						loading={regenerating}
						disabled={!editable}>再生成</Button
					>
				</div>
			{/if}
		{/snippet}

		{#snippet badge()}
			{#if inProgress}
				{#if stageLabel}<span class="editing-impression-item__stage-label">{stageLabel}</span>{/if}
			{:else if outcome === 'draft_only'}
				<span class="editing-impression-item__element-status" data-status="draft_only"
					>編集失敗</span
				>
			{:else if outcome === 'gen_failed'}
				<span class="editing-impression-item__element-status" data-status="gen_failed"
					>生成失敗</span
				>
			{/if}
		{/snippet}
	</PostItem>
</div>

<style>
	.editing-impression-item {
		padding: 16px;
		background: var(--white);
		border: solid 1px var(--svelte-ui-border-weak-color);
		border-radius: 4px;
	}
	.editing-impression-item__stage-label {
		font-size: var(--svelte-ui-font-size-sm);
		padding: 1px 6px;
		border-radius: 3px;
		background: #ede7f6;
		color: #5e35b1;
	}
	.editing-impression-item__element-status {
		font-size: var(--svelte-ui-font-size-sm);
		padding: 1px 6px;
		border-radius: 3px;
		background: #ffebee;
		color: #c62828;
	}
	.editing-impression-item__element-status[data-status='draft_only'] {
		background: #fff8e1;
		color: #f57f17;
	}
	.editing-impression-item__regenerate {
		margin-top: 8px;
	}
</style>
