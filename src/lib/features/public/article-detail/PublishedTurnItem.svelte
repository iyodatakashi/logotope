<script lang="ts">
	import { Button } from '@14ch/svelte-ui';
	import PublishedAwarenessDialog from './PublishedAwarenessDialog.svelte';
	import type { PublishedTurn } from '$lib/models/published/published-article.types';
	import { convertToHtml } from '$lib/utils/formatText';

	interface Props {
		turn: PublishedTurn;
	}
	let { turn }: Props = $props();

	// 気づきは本文に展開せず、1件以上のときだけアフォーダンスを出しダイアログへ委ねる（Req 3.1, 3.2, 3.4）。
	const awarenessCount = $derived(turn.awarenesses.length);
	let dialogRef: ReturnType<typeof PublishedAwarenessDialog> | undefined = $state();
</script>

<div
	class="published-turn-item"
	class:published-turn-item--facilitator={turn.speakerType === 'facilitator'}
>
	<div class="published-turn-item__speaker">
		<span class="published-turn-item__name">{turn.speakerName}</span>
		{#if turn.speakerRole}
			<span class="published-turn-item__role">{turn.speakerRole}</span>
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
		<PublishedAwarenessDialog bind:this={dialogRef} awarenesses={turn.awarenesses} />
	{/if}
</div>

<style>
	.published-turn-item {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.published-turn-item__speaker {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.published-turn-item__name {
		font-weight: bold;
	}
	.published-turn-item__role {
		color: var(--svelte-ui-text-color);
	}
	.published-turn-item--facilitator .published-turn-item__name {
		color: red;
	}
</style>
