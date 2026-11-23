<script lang="ts">
	import type { PublishedImpression } from '#lib/models/publishedArticle/publishedArticle.types.ts';
	import type { PersonaForDisplay } from '#lib/models/persona/persona.types.ts';
	import { convertToHtml } from '#lib/utils/formatText.ts';
	import PostItem from '#lib/sharedComponents/PostItem.svelte';

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
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- convertToHtml でエスケープ済み -->
		{@html convertToHtml(impression.content)}
	{/snippet}
</PostItem>
