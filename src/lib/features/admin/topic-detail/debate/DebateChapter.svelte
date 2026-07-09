<script lang="ts">
	import EngagementList from './EngagementList.svelte';
	import type { Turn } from '$lib/models/turn/turn.types';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';

	interface Props {
		title: string;
		turns: Turn[]; // この章のターン（原本順）
		// 原本ターンid → そのターンを聞いて各ペルソナが得た気づき。型に畳まず描画時に personaMap で解決する。
		awarenessesByTurn: Map<string, { personaId: string; content: string }[]>;
	}
	let { title, turns, awarenessesByTurn }: Props = $props();

	// 話者名/役割・指名先・気づき話者名を描画時に解決するための引き当て表は storeから直接読む。
	const personaMap = $derived(currentTopicStore.personasStore.personaMap);

	// 話者ラベルは Turn と同じく personaId から描画時に解決する（型には畳まない）。
	const speakerLabel = (turn: Turn) => {
		const persona = turn.personaId ? personaMap.get(turn.personaId) : null;
		return {
			name: persona?.name ?? 'ファシリテーター',
			role: persona?.specificRole ?? persona?.stakeholderRole ?? ''
		};
	};
</script>

<section class="debate-chapter">
	<h3 class="debate-chapter__title">{title}</h3>
	<div class="debate-chapter__turns">
		{#each turns as turn, i (turn.id)}
			{@const speaker = speakerLabel(turn)}
			{@const addressedPersona = turn.targetPersonaId
				? personaMap.get(turn.targetPersonaId)
				: null}
			{@const awarenesses = awarenessesByTurn.get(turn.id) ?? []}
			<div
				class="debate-chapter__turn"
				class:debate-chapter__turn--facilitator={turn.speakerType === 'facilitator'}
			>
				<div class="debate-chapter__speaker">
					<div class="debate-chapter__speaker-name">{speaker.name}</div>
					{#if speaker.role}
						<span class="debate-chapter__role">({speaker.role})</span>
					{/if}
					{#if turn.speechMode}
						<span class="debate-chapter__speech-mode" data-mode={turn.speechMode}>
							{turn.speechMode}{#if turn.engagementScore}({turn.engagementScore}){/if}
						</span>
					{/if}
					{#if turn.fromQueue}
						<span class="debate-chapter__from-queue">[キュー]</span>
					{/if}
				</div>
				<p class="debate-chapter__content">{turn.content}</p>
				{#if addressedPersona}
					<p class="debate-chapter__nominated">次の指名: {addressedPersona.name}</p>
				{/if}
				<EngagementList turnId={turn.id} selectedPersonaId={turns[i + 1]?.personaId} />
				{#if awarenesses.length > 0}
					<ul class="debate-chapter__awarenesses">
						{#each awarenesses as aw, awIdx (awIdx)}
							<li>💡 {personaMap.get(aw.personaId)?.name ?? ''}: {aw.content}</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/each}
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
	.debate-chapter__turn {
		padding: 12px;
		border-left: 4px solid #e0e0e0;
	}
	.debate-chapter__turn.debate-chapter__turn--facilitator {
		border-left-color: #1565c0;
		background: #f8f9ff;
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
	.debate-chapter__role {
		color: #757575;
		font-size: 0.875rem;
		margin-left: 4px;
	}
	.debate-chapter__speech-mode {
		font-size: 0.75rem;
		margin-left: 6px;
		color: #555;
		background: #eee;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.debate-chapter__speech-mode[data-mode='opinion'] {
		background: #e8f5e9;
		color: #2e7d32;
	}
	.debate-chapter__speech-mode[data-mode='fact'] {
		background: #e3f2fd;
		color: #1565c0;
	}
	.debate-chapter__from-queue {
		font-size: 0.75rem;
		margin-left: 4px;
		color: #fff;
		background: #e65100;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.debate-chapter__content {
		margin: 0;
		line-height: 1.6;
	}
	.debate-chapter__nominated {
		margin: 4px 0 0;
		font-size: 0.75rem;
		color: #b45309;
		background: #fef3c7;
		padding: 2px 8px;
		border-radius: 3px;
		display: inline-block;
	}
	.debate-chapter__awarenesses {
		margin-top: 8px;
		font-size: 0.85rem;
		color: var(--svelte-ui-text-subtle-color);
		list-style: none;
		padding: 0;
	}
</style>
