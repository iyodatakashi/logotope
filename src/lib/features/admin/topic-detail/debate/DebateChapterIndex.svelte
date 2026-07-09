<script lang="ts">
	import type { Chapter } from '$lib/models/chapter/chapter.types';

	interface Props {
		chapters: Chapter[];
		currentChapter: Chapter | null; // 進行中の章（論点の進捗バッジを出す対象）
	}
	let { chapters, currentChapter }: Props = $props();
</script>

<ol class="debate-chapter-index">
	{#each chapters as chapter (chapter.id)}
		<li class:debate-chapter-index__chapter--current={chapter === currentChapter}>
			<div class="debate-chapter-index__title">{chapter.title}</div>
			{#if chapter === currentChapter && chapter.agendaItemStatuses?.length}
				<ul class="debate-chapter-index__points">
					{#each chapter.agendaItemStatuses as dp (dp.point)}
						<li class="debate-chapter-index__point" data-status={dp.status}>
							<span class="debate-chapter-index__status-badge"
								>{dp.status === 'untouched' ? '未' : dp.status === 'introduced' ? '着' : '済'}</span
							>
							{dp.point}
						</li>
					{/each}
				</ul>
			{:else if chapter.agenda?.length}
				<ul class="debate-chapter-index__points">
					{#each chapter.agenda as point (point)}
						<li class="debate-chapter-index__point">{point}</li>
					{/each}
				</ul>
			{/if}
		</li>
	{/each}
</ol>

<style>
	.debate-chapter-index {
		padding-left: 24px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.debate-chapter-index li {
		color: #888;
		font-size: 0.9rem;
	}
	.debate-chapter-index li.debate-chapter-index__chapter--current {
		color: #1565c0;
		font-weight: 600;
	}
	.debate-chapter-index__points {
		margin: 4px 0 0 8px;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.debate-chapter-index__point {
		display: flex;
		align-items: baseline;
		gap: 6px;
		font-size: 0.78rem;
		font-weight: normal;
		color: #666;
	}
	.debate-chapter-index__status-badge {
		flex-shrink: 0;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 1px 4px;
		border-radius: 3px;
		background: #e0e0e0;
		color: #757575;
	}
	.debate-chapter-index__point[data-status='introduced'] .debate-chapter-index__status-badge {
		background: #fff3e0;
		color: #e65100;
	}
	.debate-chapter-index__point[data-status='addressed'] .debate-chapter-index__status-badge {
		background: #e8f5e9;
		color: #2e7d32;
	}
</style>
