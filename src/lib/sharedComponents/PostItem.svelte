<script lang="ts">
	import { convertToHtml } from '$lib/utils/formatText';
	import type { PersonaForDisplay } from '$lib/models/persona/persona.types';
	import PersonaAvatar from '$lib/sharedComponents/PersonaAvatar.svelte';
	import { FACILITATOR_NAME } from '$lib/models/turn/turn.constants';

	// Admin・公開共通の発言アイテム。表示型 PersonaForDisplay を受け取り、名前・役割・アバターを描画する。
	// persona 欠落＝ファシリテーターは既定名へ縮退し、欠落し得る外見フィールドは PersonaAvatar が既定へ倒す。
	let { persona, content }: { persona?: PersonaForDisplay; content: string } = $props();
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
	<p class="published-turn-item__content">{@html convertToHtml(content)}</p>
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
