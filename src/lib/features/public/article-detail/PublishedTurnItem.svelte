<script lang="ts">
	import { Button } from '@14ch/svelte-ui';
	import PublishedAwarenessDialog from './PublishedAwarenessDialog.svelte';
	import type {
		PublishedPersona,
		PublishedTurn
	} from '$lib/models/published/published-article/published-article.types';
	import { convertToHtml } from '$lib/utils/formatText';
	import PersonaAvatar from '$lib/sharedComponents/PersonaAvatar.svelte';
	import { FACILITATOR_NAME } from '$lib/models/turn/turn.constants';

	interface Props {
		turn: PublishedTurn;
		personas: Map<string, PublishedPersona>;
	}
	let { turn, personas }: Props = $props();

	// 話者名/肩書は畳まず personaId 参照のまま保持し、描画時に personas で解決する。
	const persona = $derived(turn.personaId ? personas.get(turn.personaId) : undefined);

	// 気づきは本文に展開せず、1件以上のときだけアフォーダンスを出しダイアログへ委ねる（Req 3.1, 3.2, 3.4）。
	const awarenessCount = $derived(turn.awarenesses.length);
	let dialogRef: ReturnType<typeof PublishedAwarenessDialog> | undefined = $state();
</script>

<div class="published-turn-item" class:published-turn-item--facilitator={!persona}>
	<div class="published-turn-item__avatar">
		<PersonaAvatar {persona} />
	</div>
	<div class="published-turn-item__speaker">
		<span class="published-turn-item__name">{persona?.name ?? FACILITATOR_NAME}</span>
		{#if persona?.role}
			<span class="published-turn-item__role">{persona.role}</span>
		{/if}
	</div>
	<p class="published-turn-item__content">{@html convertToHtml(turn.content)}</p>
	{#if awarenessCount > 0}
		<Button
			ariaLabel="気づき {awarenessCount} 件を見る"
			icon="lightbulb"
			rounded
			size="small"
			onclick={() => dialogRef?.open()}
		>
			{awarenessCount}
		</Button>
		<PublishedAwarenessDialog bind:this={dialogRef} awarenesses={turn.awarenesses} {personas} />
	{/if}
</div>

<style>
	.published-turn-item {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-rows: auto auto auto;
		grid-gap: 4px 16px;
	}
	.published-turn-item__avatar {
		grid-row: 1/ 4;
	}

	.published-turn-item__speaker {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.published-turn-item__name {
		font-size: var(--svelte-ui-font-size-lg);
		font-weight: bold;
	}
	.published-turn-item__role {
		color: var(--svelte-ui-text-color);
	}
</style>
