<script lang="ts">
	import type { Chapter } from '$lib/models/chapter/chapter.types';

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
					{#each chapter.agendaItemStatuses as dp (dp.point)}
						<li class="debate-chapter-index__agenda-item" data-status={dp.status}>
							<span class="debate-chapter-index__status-badge"
								>{dp.status === 'untouched' ? '未' : dp.status === 'introduced' ? '着' : '済'}</span
							>
							{dp.point}
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
		align-items: baseline;
		gap: 4px;
		font-size: var(--svelte-ui-font-size-sm);
	}
	.debate-chapter-index__status-badge {
		flex-shrink: 0;
		font-size: var(--svelte-ui-font-size-sm);
		font-weight: 700;
		padding: 1px 4px;
		border-radius: 3px;
		background: #e0e0e0;
		color: #757575;
	}
	.debate-chapter-index__agenda-item[data-status='introduced'] .debate-chapter-index__status-badge {
		background: #fff3e0;
		color: #e65100;
	}
	.debate-chapter-index__agenda-item[data-status='addressed'] .debate-chapter-index__status-badge {
		background: #e8f5e9;
		color: #2e7d32;
	}
</style>
