<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '@14ch/svelte-ui';
	import { topicsStore } from '$lib/stores/topics.svelte';
	import { phaseDisplayLabel } from '$lib/models/phase/phase';
	import type { PhaseSlug, PhaseStatus } from '$lib/models/phase/phase.types';

	const getBadge = (topic: {
		phase: PhaseSlug;
		phaseStatus: PhaseStatus;
	}): { label: string; styleKey: string } =>
		phaseDisplayLabel({ phase: topic.phase, phaseStatus: topic.phaseStatus });
</script>

<div class="topic-list-page">
	<header>
		<h1>管理ダッシュボード</h1>
		<div class="topic-list-page__actions">
			<Button variant="filled" onclick={() => goto('/admin/topics/new')}>新しいテーマを作成</Button>
		</div>
	</header>

	{#if !topicsStore.isLoaded}
		<p>読み込み中...</p>
	{:else if topicsStore.topics.length === 0}
		<p class="topic-list-page__empty">テーマがありません。新しいテーマを作成してください。</p>
	{:else}
		<ul class="topic-list-page__topic-list">
			{#each topicsStore.topics as topic (topic.id)}
				{@const badge = getBadge(topic)}
				<li class="topic-list-page__topic-card">
					<a href={`/admin/topics/${topic.id}`}>
						<span class="topic-list-page__title">{topic.title}</span>
						<span class="topic-list-page__badge topic-list-page__badge--{badge.styleKey}"
							>{badge.label}</span
						>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.topic-list-page {
		max-width: 800px;
		margin: 0 auto;
		padding: 24px;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 24px;
	}
	.topic-list-page__actions {
		display: flex;
		gap: 8px;
	}
	.topic-list-page__topic-list {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.topic-list-page__topic-card a {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 16px;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		text-decoration: none;
		color: inherit;
	}
	.topic-list-page__topic-card a:hover {
		background: #f5f5f5;
	}
	.topic-list-page__badge {
		padding: 4px 8px;
		border-radius: 4px;
		font-size: var(--svelte-ui-font-size-sm);
		font-weight: bold;
	}
	.topic-list-page__badge--pending {
		background: #e0e0e0;
	}
	.topic-list-page__badge--running {
		background: #bbdefb;
		color: #1565c0;
	}
	.topic-list-page__badge--ready {
		background: #fff9c4;
		color: #f57f17;
	}
	.topic-list-page__badge--completed {
		background: #c8e6c9;
		color: #2e7d32;
	}
	.topic-list-page__badge--stopped {
		background: #ffcdd2;
		color: #c62828;
	}
	.topic-list-page__empty {
		color: #757575;
	}
</style>
