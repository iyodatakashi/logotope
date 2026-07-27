<script lang="ts">
	import { Skeleton } from '@14ch/svelte-ui';
	import DebateTurnItem from './DebateTurnItem.svelte';
	import type { Turn } from '$lib/models/turn/turn.types';
	import { FACILITATOR_NAME } from '$lib/models/turn/turn.constants';
	import type { Chapter, PendingTurn } from '$lib/models/chapter/chapter.types';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';

	interface Props {
		chapter: Chapter; // この章（タイトル・確定ターン列・生成中ターンを含む）
	}
	let { chapter }: Props = $props();

	// 話者名/役割・指名先・気づき話者名を描画時に解決するための引き当て表は storeから直接読む。
	const personaMap = $derived(currentTopicStore.personasStore.personaMap);

	// 話者ラベルは Turn と同じく personaId から描画時に解決する（型には畳まない）。
	const speakerLabel = (turn: Turn) => {
		const persona = turn.personaId ? personaMap.get(turn.personaId) : null;
		return {
			name: persona?.name ?? FACILITATOR_NAME,
			role: persona?.role ?? ''
		};
	};

	// 生成中ターンの段階ラベル（generating: 本文生成中 / fact-checking: 検証中）。
	const pendingStatusLabel = (status: PendingTurn['status']) =>
		status === 'fact-checking' ? 'ファクトチェック中' : '発言を生成中';
</script>

<section class="debate-chapter">
	<h3 class="debate-chapter__title">{chapter.title}</h3>
	<div class="debate-chapter__turns">
		{#each chapter.turns as turn, i (turn.id)}
			{@const speaker = speakerLabel(turn)}
			{@const targetPersona = turn.targetPersonaId ? personaMap.get(turn.targetPersonaId) : null}
			{@const awarenesses = currentTopicStore.personasStore.getAwarenessesByTurn(turn.id)}
			{@const nextPersonaId = chapter.turns[i + 1]?.personaId ?? chapter.pendingTurn?.personaId}
			<DebateTurnItem {turn} {speaker} {targetPersona} {awarenesses} {nextPersonaId} />
		{/each}
		{#if chapter.pendingTurn}
			{@const pendingSpeaker = chapter.pendingTurn.personaId
				? personaMap.get(chapter.pendingTurn.personaId)
				: null}
			<div class="debate-chapter__turn debate-chapter__turn--pending">
				<div class="debate-chapter__speaker">
					<div class="debate-chapter__speaker-name">
						{pendingSpeaker?.name ?? FACILITATOR_NAME}
					</div>
					{#if pendingSpeaker?.role}
						<span class="debate-chapter__role">
							({pendingSpeaker.role})
						</span>
					{/if}
					<span class="debate-chapter__pending-status">
						{pendingStatusLabel(chapter.pendingTurn.status)}
					</span>
				</div>
				<Skeleton patterns={[{ type: 'text', lines: 3 }]} />
			</div>
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
		gap: 16px;
	}
	.debate-chapter__turn {
		padding: 16px;
		background: var(--white);
		border-radius: 4px;
	}
	.debate-chapter__speaker {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
	}
	.debate-chapter__speaker-name {
		font-weight: bold;
	}
	.debate-chapter__turn--pending {
		opacity: 0.85;
	}
	.debate-chapter__pending-status {
		font-size: var(--svelte-ui-font-size-sm);
	}
</style>
