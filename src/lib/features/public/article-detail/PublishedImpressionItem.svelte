<script lang="ts">
	import type { PublishedImpression } from '$lib/models/published/published-article/published-article.types';
	import type { PersonaForDisplay } from '$lib/models/persona/persona.types';
	import { convertToHtml } from '$lib/utils/formatText';
	import PostItem from '$lib/sharedComponents/PostItem.svelte';

	interface Props {
		impression: PublishedImpression;
		personas: Map<string, PersonaForDisplay>;
	}
	let { impression, personas }: Props = $props();

	// 話者名/肩書は畳まず personaId 参照のまま保持し、描画時に personas で解決する。
	const persona = $derived(personas.get(impression.personaId));
</script>

<PostItem {persona}>
	{#snippet content()}
		{@html convertToHtml(impression.content)}
	{/snippet}
</PostItem>
