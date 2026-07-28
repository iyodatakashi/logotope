<script lang="ts">
	import { Button } from '@14ch/svelte-ui';
	import PostItem from '$lib/sharedComponents/PostItem.svelte';
	import PublishedAwarenessDialog from './PublishedAwarenessDialog.svelte';
	import type { PublishedTurn } from '$lib/models/published/published-article/published-article.types';
	import type { PersonaForDisplay } from '$lib/models/persona/persona.types';
	import { convertToHtml } from '$lib/utils/formatText';
	import PersonaAvatar from '$lib/sharedComponents/PersonaAvatar.svelte';
	import { FACILITATOR_NAME } from '$lib/models/turn/turn.constants';

	interface Props {
		turn: PublishedTurn;
		personas: Map<string, PersonaForDisplay>;
	}
	let { turn, personas }: Props = $props();

	// 話者名/肩書は畳まず personaId 参照のまま保持し、描画時に personas で解決する。
	const persona = $derived(turn.personaId ? personas.get(turn.personaId) : undefined);

	// 気づきは本文に展開せず、1件以上のときだけアフォーダンスを出しダイアログへ委ねる（Req 3.1, 3.2, 3.4）。
	const awarenessCount = $derived(turn.awarenesses.length);
	let dialogRef: ReturnType<typeof PublishedAwarenessDialog> | undefined = $state();
</script>

<PostItem {persona} addition={awarenessCount > 0 ? addition : undefined}>
	{#snippet content()}
		{@html convertToHtml(turn.content)}
	{/snippet}
</PostItem>

{#snippet addition()}
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
{/snippet}
