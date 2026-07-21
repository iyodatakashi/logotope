<script lang="ts">
	import PublishedTurnItem from './PublishedTurnItem.svelte';
	import type {
		PublishedChapter,
		PublishedPersona
	} from '$lib/models/published/published-article/published-article.types';

	interface Props {
		chapter: PublishedChapter;
		personas: Map<string, PublishedPersona>;
	}
	let { chapter, personas }: Props = $props();
</script>

<!-- id/data-chapter-index は安定な chapterIndex。目次アンカーとスクロール追従の監視対象になる（Req 1.4, 2.1, 4.2, 4.3）。 -->
<section class="published-chapter" id="chapter-{chapter.index}" data-chapter-index={chapter.index}>
	<h2 class="published-chapter__title">{chapter.title}</h2>
	<div class="published-chapter__turns">
		{#each chapter.turns as turn (turn.id)}
			<PublishedTurnItem {turn} {personas} />
		{/each}
	</div>
</section>

<style>
	.published-chapter {
		display: flex;
		flex-direction: column;
		gap: 16px;
		scroll-margin-top: 24px;
	}
	.published-chapter__title {
		font-size: 1.5rem;
		font-weight: bold;
	}
	.published-chapter__turns {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
</style>
