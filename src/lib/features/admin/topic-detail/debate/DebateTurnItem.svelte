<script lang="ts">
	import type { Turn } from '$lib/models/turn/turn.types';
	import type { Persona } from '$lib/models/persona/persona.types';
	import EngagementList from './EngagementList.svelte';
	import EngagementListSkeleton from './EngagementListSkeleton.svelte';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import PostItem from '$lib/sharedComponents/PostItem.svelte';

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

	// 外見は公開記事と同じ部品に解決させる。話者をペルソナに解決できない場合は既定で描画される。
	// PostItem は表示型 PersonaForDisplay を受け取るため、写像は store の解決メソッドに委ねる。
	const persona = $derived(currentTopicStore.personasStore.getPersonaForDisplay(turn.personaId));
</script>

<div class="debate-turn-item">
	<PostItem {persona} content={turn.content}>
		{#snippet addition()}
			<div class="debate-turn-item__addition">
				{#if turn.speechMode}
					<span class="debate-turn-item__speech-mode" data-mode={turn.speechMode}>
						{turn.speechMode}{#if turn.engagementScore}({turn.engagementScore}){/if}
					</span>
				{/if}
				{#if turn.fromQueue}
					<span class="debate-turn-item__from-queue">[キュー]</span>
				{/if}
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
										{currentTopicStore.personasStore.getPersona(aw.personaId)?.name ?? ''}:
									</span>
									{aw.content}
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
		{/snippet}
	</PostItem>
</div>

<style>
	.debate-turn-item {
		padding: 16px;
		background: var(--white);
		border: solid 1px var(--svelte-ui-border-weak-color);
		border-radius: 4px;
	}
	.debate-turn-item__addition {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.debate-turn-item__speech-mode {
		width: fit-content;
		font-size: var(--svelte-ui-font-size-sm);
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
