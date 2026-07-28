<script lang="ts">
	import DiffText from '$lib/sharedComponents/DiffText.svelte';
	import { computeInlineDiff } from '$lib/utils/inlineDiff';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import type { EditedChapterDisplayStatus } from '$lib/models/chapter/chapter.types';
	import type { TurnForEditing } from '$lib/models/turn/turn.types';
	import PostItem from '$lib/sharedComponents/PostItem.svelte';
	import { convertToHtml } from '@14ch/svelte-ui';

	interface Props {
		turn: TurnForEditing;
		status: EditedChapterDisplayStatus; // 差分表示の可否判定に使う（completed のみ差分を出す）
		showDiff: boolean;
		contentById: Map<string, string>; // 由来原本id→原本テキスト（差分の由来参照）。章から共有される
	}
	let { turn, status, showDiff, contentById }: Props = $props();

	// 話者ラベルは Turn と同じく描画時に personaId から store の解決メソッドで引く（型には畳まない）。
	const persona = $derived(currentTopicStore.personasStore.getPersonaForDisplay(turn.personaId));

	// 行の由来原本id群から気づきを引く（編集後は連結元、原本/削除は自id）。store から直接引く。
	const awarenesses = $derived(
		turn.sourceTurnIds.flatMap((id) => currentTopicStore.personasStore.getAwarenessesByTurn(id))
	);

	// 由来原本テキスト（sourceTurnIds 順に結合）↔ 編集後の差分を描画時に算出する（型には持たせない）。
	const diff = $derived(
		showDiff && status === 'completed'
			? computeInlineDiff(
					turn.sourceTurnIds.map((id) => contentById.get(id) ?? '').join(''),
					turn.content
				)
			: null
	);
</script>

<div class="editing-turn-item">
	<PostItem {persona}>
		{#snippet content()}
			{#if turn.removed}
				{#if showDiff}
					<span class="editing-turn-item__removed-label">発言ごと削除</span>
				{/if}
			{:else if diff}
				<p class="editing-turn-item__content"><DiffText segments={diff} /></p>
			{:else}
				<p class="editing-turn-item__content">
					{@html convertToHtml(turn.content)}
				</p>
			{/if}
		{/snippet}
	</PostItem>
</div>

<style>
	.editing-turn-item {
		padding: 16px;
		background: var(--white);
		border: solid 1px var(--svelte-ui-border-weak-color);
		border-radius: 4px;
	}

	.editing-turn-item__removed-label {
		font-size: var(--svelte-ui-font-size-sm);
		margin-left: 6px;
		color: #fff;
		background: #c62828;
		padding: 1px 5px;
		border-radius: 3px;
	}
</style>
