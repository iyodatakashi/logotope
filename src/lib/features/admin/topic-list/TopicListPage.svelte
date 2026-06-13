<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '@14ch/svelte-ui';
	import { authStore } from '$lib/stores/auth.svelte.js';
	import { topicsStore } from '$lib/stores/topics.svelte.js';
	import { phaseDisplayLabel, deriveLegacyPhaseState } from '$lib/utils/phase.js';
	import type { Phase, PhaseStatus } from '$lib/utils/phase.js';

	const getBadge = (topic: {
		phase?: Phase;
		phaseStatus?: PhaseStatus;
		status: string;
	}): { label: string; styleKey: string } => {
		if (topic.phase) {
			return phaseDisplayLabel({ phase: topic.phase, phaseStatus: topic.phaseStatus ?? 'not_started' });
		}
		const { phase, phaseStatus } = deriveLegacyPhaseState(topic.status);
		return phaseDisplayLabel({ phase, phaseStatus });
	};
</script>

<div class="dashboard">
	<header>
		<h1>管理ダッシュボード</h1>
		<div class="actions">
			<Button variant="filled" onclick={() => goto('/admin/topics/new')}>新しいテーマを作成</Button>
			<Button variant="ghost" onclick={() => authStore.logout()}>ログアウト</Button>
		</div>
	</header>

	{#if !topicsStore.isLoaded}
		<p>読み込み中...</p>
	{:else if topicsStore.topics.length === 0}
		<p class="empty">テーマがありません。新しいテーマを作成してください。</p>
	{:else}
		<ul class="topic-list">
			{#each topicsStore.topics as topic (topic.id)}
				{@const badge = getBadge(topic)}
				<li class="topic-card">
					<a href={`/admin/topics/${topic.id}`}>
						<span class="title">{topic.title}</span>
						<span class="badge style-{badge.styleKey}">{badge.label}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.dashboard {
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
	.actions {
		display: flex;
		gap: 8px;
	}
	.topic-list {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.topic-card a {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 16px;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		text-decoration: none;
		color: inherit;
	}
	.topic-card a:hover {
		background: #f5f5f5;
	}
	.badge {
		padding: 4px 8px;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 600;
	}
	.style-pending {
		background: #e0e0e0;
	}
	.style-running {
		background: #bbdefb;
		color: #1565c0;
	}
	.style-ready {
		background: #fff9c4;
		color: #f57f17;
	}
	.style-completed {
		background: #c8e6c9;
		color: #2e7d32;
	}
	.empty {
		color: #757575;
	}
</style>
