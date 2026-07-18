<script lang="ts">
	import type { Turn } from '$lib/models/turn/turn.types';
	import type { Persona } from '$lib/models/persona/persona.types';
	import EngagementList from './EngagementList.svelte';
	import EngagementListSkeleton from './EngagementListSkeleton.svelte';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';

	let {
		turn,
		speaker,
		targetPersona,
		awarenesses,
		nextPersonaId
	}: {
		turn: Turn;
		speaker: {
			name: string;
			role: string;
		};
		targetPersona: Persona | null | undefined;
		awarenesses: {
			personaId: string;
			content: string;
		}[];
		nextPersonaId: string | null | undefined; // このターンの後に選ばれた次の話者
	} = $props();

	const personaMap = $derived(currentTopicStore.personasStore.personaMap);
</script>

<div
	class="debate-turn-item"
	class:debate-turn-item--facilitator={turn.speakerType === 'facilitator'}
>
	<div class="debate-turn-item__speaker">
		<div class="debate-turn-item__speaker-name">{speaker.name}</div>
		{#if speaker.role}
			<span class="debate-turn-item__role">（{speaker.role}）</span>
		{/if}
		{#if turn.speechMode}
			<span class="debate-turn-item__speech-mode" data-mode={turn.speechMode}>
				{turn.speechMode}{#if turn.engagementScore}({turn.engagementScore}){/if}
			</span>
		{/if}
		{#if turn.fromQueue}
			<span class="debate-turn-item__from-queue">[キュー]</span>
		{/if}
	</div>
	<p class="debate-turn-item__content">{turn.content}</p>
	{#if targetPersona}
		<p class="debate-turn-item__nominated">次の指名: {targetPersona.name}</p>
	{/if}
	{#if turn.status === 'evaluating'}
		<EngagementListSkeleton speakerPersonaId={turn.personaId} />
	{:else}
		<EngagementList turnId={turn.id} selectedPersonaId={nextPersonaId} />

		{#if awarenesses.length > 0}
			<ul class="debate-turn-item__awarenesses">
				{#each awarenesses as aw, awIdx (awIdx)}
					<li>
						<span class="debate-turn-item__awareness-persona-name">
							{personaMap.get(aw.personaId)?.name ?? ''}:
						</span>
						{aw.content}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<style>
	.debate-turn-item {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px;
		background: var(--white);
		border: solid 1px var(--svelte-ui-border-weak-color);
		border-radius: 4px;
	}
	.debate-turn-item.debate-turn-item--facilitator {
		padding-top: 8px;
		border-top: solid 8px var(--primary-500);
		background: var(--primary-100);
	}
	.debate-turn-item__speaker {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.debate-turn-item__speaker-name {
		font-weight: bold;
	}
	.debate-turn-item__role {
		color: #757575;
		font-size: var(--svelte-ui-font-size-sm);
	}
	.debate-turn-item__speech-mode {
		font-size: var(--svelte-ui-font-size-sm);
		color: #555;
		background: #eee;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.debate-turn-item__speech-mode[data-mode='opinion'] {
		background: #e8f5e9;
		color: #2e7d32;
	}
	.debate-turn-item__speech-mode[data-mode='fact'] {
		background: #e3f2fd;
		color: #1565c0;
	}
	.debate-turn-item__from-queue {
		font-size: var(--svelte-ui-font-size-sm);
		color: #fff;
		background: #e65100;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.debate-turn-item__nominated {
		display: inline-block;
		width: fit-content;
		background: #fef3c7;
		padding: 2px 8px;
		border-radius: 3px;
		font-size: var(--svelte-ui-font-size-sm);
		color: #b45309;
	}
	.debate-turn-item__awarenesses {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: var(--svelte-ui-font-size-sm);
		color: var(--svelte-ui-text-subtle-color);
		line-height: normal;
	}

	.debate-turn-item__awareness-persona-name {
		font-weight: bold;
	}
</style>
