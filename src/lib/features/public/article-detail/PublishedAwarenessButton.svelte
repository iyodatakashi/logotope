<script lang="ts">
	import { IconButton } from '@14ch/svelte-ui';
	import PublishedAwarenessDialog from './PublishedAwarenessDialog.svelte';
	import type { PublishedSpeech } from '$lib/models/published/published-article.types';

	interface Props {
		speech: PublishedSpeech;
	}
	let { speech }: Props = $props();

	// 気づきは本文に展開せず、1件以上のときだけアフォーダンスを出しダイアログへ委ねる（Req 3.1, 3.2, 3.4）。
	const awarenessCount = $derived(speech.awarenesses.length);
	let dialogRef: ReturnType<typeof PublishedAwarenessDialog> | undefined = $state();
</script>

<div
	class="published-awareness-button"
	class:published-awareness-button--facilitator={speech.speakerType === 'facilitator'}
>
	<div class="published-awareness-button__speaker">
		<span class="published-awareness-button__name">{speech.speakerName}</span>
		{#if speech.speakerRole}
			<span class="published-awareness-button__role">（{speech.speakerRole}）</span>
		{/if}
		{#if awarenessCount > 0}
			<IconButton
				ariaLabel="気づき {awarenessCount} 件を見る"
				size={28}
				fontSize={18}
				onclick={() => dialogRef?.open()}
				hasBadge
				badgeCount={awarenessCount}
			>
				lightbulb
			</IconButton>
		{/if}
	</div>
	<p class="published-awareness-button__content">{speech.content}</p>
	{#if awarenessCount > 0}
		<PublishedAwarenessDialog bind:this={dialogRef} awarenesses={speech.awarenesses} />
	{/if}
</div>

<style>
	.published-awareness-button {
		padding: 12px 0;
	}
	.published-awareness-button__speaker {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
	}
	.published-awareness-button__name {
		font-weight: bold;
	}
	.published-awareness-button__role {
		font-size: var(--svelte-ui-font-size-sm);
		color: #757575;
	}
	.published-awareness-button--facilitator .published-awareness-button__name {
		color: #1565c0;
	}
	.published-awareness-button__content {
		margin: 0;
		line-height: 1.8;
		white-space: pre-wrap;
	}
</style>
