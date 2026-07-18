<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import type { PublishedChapter } from '$lib/models/published/published-article.types';

	interface Props {
		chapters: Pick<PublishedChapter, 'index' | 'title'>[];
	}
	let { chapters }: Props = $props();

	// 現在表示中の章は状態クラスで強調する（要素差し替えはしない・Req 4.4）。SSR/監視前は強調なし。
	let activeIndex = $state<number | null>(null);

	// ブラウザ限定で記事ペインの章セクションの可視状態を監視し、現在章を activeIndex に反映する（Req 4.3）。
	onMount(() => {
		if (!browser) return;
		const sections = document.querySelectorAll<HTMLElement>('[data-chapter-index]');
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						activeIndex = Number(entry.target.getAttribute('data-chapter-index'));
					}
				}
			},
			// 上寄りに入った章を現在地とみなす（先頭付近優先）。
			{ rootMargin: '0px 0px -70% 0px', threshold: 0 }
		);
		for (const section of sections) observer.observe(section);
		return () => observer.disconnect();
	});
</script>

<nav class="article-toc" aria-label="目次">
	<ul class="article-toc__list">
		{#each chapters as chapter (chapter.index)}
			<li class="article-toc__item" class:article-toc__item--active={chapter.index === activeIndex}>
				<a class="article-toc__link" href="#chapter-{chapter.index}">{chapter.title}</a>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.article-toc__list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.article-toc__link {
		display: block;
		padding: 6px 8px;
		border-left: 2px solid transparent;
		border-radius: 0 4px 4px 0;
		text-decoration: none;
		color: #757575;
		font-size: var(--svelte-ui-font-size-sm);
		line-height: 1.5;
		transition:
			color 0.15s,
			background 0.15s,
			border-color 0.15s;
	}
	.article-toc__link:hover {
		background: #f5f5f5;
		color: #333;
	}
	.article-toc__item--active .article-toc__link {
		border-left-color: #7b1fa2;
		color: #7b1fa2;
		font-weight: 700;
	}
</style>
