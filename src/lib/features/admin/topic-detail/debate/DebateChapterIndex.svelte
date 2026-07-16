<script lang="ts">
	import type { Chapter } from '$lib/models/chapter/chapter.types';
	import { Icon } from '@14ch/svelte-ui';

	interface Props {
		chapters: Chapter[];
		currentChapter: Chapter | null; // 進行中の章（論点の進捗バッジを出す対象）
	}
	let { chapters, currentChapter }: Props = $props();
</script>

<ul class="debate-chapter-index">
	{#each chapters as chapter (chapter.id)}
		<li
			class="debate-chapter-index__chapter"
			class:debate-chapter-index__chapter--current={chapter === currentChapter}
		>
			<div class="debate-chapter-index__title">{chapter.title}</div>
			{#if chapter === currentChapter && chapter.agendaItemStatuses?.length}
				<ul class="debate-chapter-index__agenda">
					{#each chapter.agendaItemStatuses as agendaItemStatus (agendaItemStatus.point)}
						<li class="debate-chapter-index__agenda-item" data-status={agendaItemStatus.status}>
							{#if agendaItemStatus.status === 'untouched'}
								<Icon>check_indeterminate_small</Icon>
							{:else if agendaItemStatus.status === 'introduced'}
								<Icon>cached</Icon>
							{:else}
								<Icon>check</Icon>
							{/if}
							<div class="debate-chapter-index__agenda-item__point">
								{agendaItemStatus.point}
							</div>
						</li>
					{/each}
				</ul>
			{:else if chapter.agenda?.length}
				<!--
				<ul class="debate-chapter-index__agenda">
					{#each chapter.agenda as point (point)}
						<li class="debate-chapter-index__agenda-item">{point}</li>
					{/each}
				</ul>
				-->
			{/if}
		</li>
	{/each}
</ul>

<style>
	.debate-chapter-index {
		display: flex;
		flex-direction: column;
	}

	.debate-chapter-index__chapter {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 0;
		border-bottom: solid 1px var(--svelte-ui-border-color);
	}

	.debate-chapter-index__chapter--current .debate-chapter-index__title {
		font-weight: bold;
	}

	.debate-chapter-index__agenda {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 0;
	}
	.debate-chapter-index__agenda-item {
		display: flex;
		align-items: top;
		gap: 8px;
		font-size: var(--svelte-ui-font-size-sm);
	}

	.debate-chapter-index__agenda-item[data-status='introduced'] :global(.icon) {
		animation: debate-chapter-index-spin 2.4s linear infinite;
	}

	@keyframes debate-chapter-index-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.debate-chapter-index__agenda-item[data-status='introduced'] :global(.icon) {
			animation: none;
		}
	}
</style>
