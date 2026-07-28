<script lang="ts">
	import { Skeleton } from '@14ch/svelte-ui';
	import DebateTurnItem from './DebateTurnItem.svelte';
	import PostItem from '$lib/sharedComponents/PostItem.svelte';
	import type { Chapter, PendingTurn } from '$lib/models/chapter/chapter.types';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import PendingTurnSkeleton from './PendingTurnSkeleton.svelte';

	interface Props {
		chapter: Chapter; // この章（タイトル・確定ターン列・生成中ターンを含む）
	}
	let { chapter }: Props = $props();

	// 生成中ターンの段階ラベル（generating: 本文生成中 / fact-checking: 検証中）。
	const pendingStatusLabel = (status: PendingTurn['status']) =>
		status === 'fact-checking' ? 'ファクトチェック中' : '発言を生成中';
</script>

<section class="debate-chapter">
	<h3 class="debate-chapter__title">{chapter.title}</h3>
	<div class="debate-chapter__turns">
		{#each chapter.turns as turn, i (turn.id)}
			{@const targetPersona = currentTopicStore.personasStore.getPersona(turn.targetPersonaId)}
			{@const awarenesses = currentTopicStore.personasStore.getAwarenessesByTurn(turn.id)}
			{@const nextPersonaId = chapter.turns[i + 1]?.personaId ?? chapter.pendingTurn?.personaId}
			<DebateTurnItem {turn} {targetPersona} {awarenesses} {nextPersonaId} />
		{/each}
		{#if chapter.pendingTurn}
			{@const persona = currentTopicStore.personasStore.getPersonaForDisplay(
				chapter.pendingTurn.personaId
			)}
			<PendingTurnSkeleton {persona} status={pendingStatusLabel(chapter.pendingTurn.status)} />
		{/if}
	</div>
</section>

<style>
	.debate-chapter__title {
		font-size: 1.5rem;
		font-weight: bold;
		margin: 0 0 8px;
	}
	.debate-chapter__turns {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
</style>
