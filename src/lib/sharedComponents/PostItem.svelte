<script lang="ts">
	import type { PersonaForDisplay } from '$lib/models/persona/persona.types';
	import PersonaAvatar from '$lib/sharedComponents/PersonaAvatar.svelte';
	import type { Snippet } from 'svelte';
	import { FACILITATOR_NAME } from '$lib/models/turn/turn.constants';

	// Admin・公開共通の発言アイテム。表示型 PersonaForDisplay を受け取り、名前・役割・アバターを描画する。
	// persona 欠落＝ファシリテーターは既定名へ縮退し、欠落し得る外見フィールドは PersonaAvatar が既定へ倒す。
	let {
		persona,
		content,
		addition,
		badge
	}: {
		persona?: PersonaForDisplay;
		content: Snippet;
		addition?: Snippet;
		badge?: Snippet;
	} = $props();
</script>

<div class="post-item" class:post-item--facilitator={!persona}>
	<div class="post-item__avatar">
		<PersonaAvatar {persona} />
	</div>
	<div class="post-item__main">
		<div class="post-item__header">
			<span class="post-item__name">{persona?.name ?? FACILITATOR_NAME}</span>
			{#if persona?.role}
				<span class="post-item__role">{persona.role}</span>
			{/if}
		</div>
		<div class="post-item__badge">
			{#if badge}
				{@render badge()}
			{/if}
		</div>
		<div class="post-item__content">
			{@render content()}
		</div>
		{#if addition}
			<div class="post-item__addition">
				{@render addition()}
			</div>
		{/if}
	</div>
</div>

<style>
	.post-item {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-gap: 8px 16px;
	}
	.post-item__main {
		display: grid;
		grid-template-columns: 1fr auto;
		grid-gap: 8px;
		align-items: baseline;
	}
	.post-item__header {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.post-item__name {
		font-size: var(--svelte-ui-font-size-lg);
		font-weight: bold;
	}
	.post-item__role {
		color: var(--svelte-ui-text-color);
	}
	.post-item__content {
		grid-column: 1 / 3;
	}
	.post-item__addition {
		grid-column: 1 / 3;
	}
</style>
