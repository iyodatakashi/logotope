<script lang="ts">
	import ArticleSpeech from './ArticleSpeech.svelte';
	import type { PublishedChapter } from '$lib/models/published/published-article.types';

	interface Props {
		chapter: PublishedChapter;
	}
	let { chapter }: Props = $props();
</script>

<!-- id/data-chapter-index は安定な chapterIndex。目次アンカーとスクロール追従の監視対象になる（Req 1.4, 2.1, 4.2, 4.3）。 -->
<section class="article-chapter" id="chapter-{chapter.index}" data-chapter-index={chapter.index}>
	<h2 class="article-chapter__title">{chapter.title}</h2>
	<div class="article-chapter__speeches">
		{#each chapter.speeches as speech (speech.id)}
			<ArticleSpeech {speech} />
		{/each}
	</div>
</section>

<style>
	.article-chapter {
		scroll-margin-top: 24px;
	}
	.article-chapter__title {
		font-size: 1.5rem;
		font-weight: bold;
		margin: 0 0 12px;
	}
	.article-chapter__speeches {
		display: flex;
		flex-direction: column;
	}
</style>
