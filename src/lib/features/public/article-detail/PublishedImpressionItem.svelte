<script lang="ts">
	import type {
		PublishedImpression,
		PublishedPersona
	} from '$lib/models/published/published-article/published-article.types';
	import { convertToHtml } from '$lib/utils/formatText';
	import { FACILITATOR_NAME } from '$lib/models/turn/turn.constants';
	import PersonaAvatar from '$lib/sharedComponents/PersonaAvatar.svelte';

	interface Props {
		impression: PublishedImpression;
		personas: Map<string, PublishedPersona>;
	}
	let { impression, personas }: Props = $props();

	// 話者名/肩書は畳まず personaId 参照のまま保持し、描画時に personas で解決する。
	const persona = $derived(personas.get(impression.personaId));
</script>

<div class="published-impression-item">
	<PersonaAvatar {persona} />
	<div class="published-impression-item__speaker">
		<span class="published-impression-item__name">{persona?.name ?? FACILITATOR_NAME}</span>
		{#if persona?.role}
			<span class="published-impression-item__role">{persona.role}</span>
		{/if}
	</div>
	<p class="published-impression-item__content">{@html convertToHtml(impression.content)}</p>
</div>

<style>
	.published-impression-item {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.published-impression-item__speaker {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.published-impression-item__name {
		font-weight: bold;
	}
</style>
