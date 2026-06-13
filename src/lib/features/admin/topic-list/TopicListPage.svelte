<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '@14ch/svelte-ui';
	import { authStore } from '$lib/stores/auth.svelte.js';
	import { topicsStore } from '$lib/stores/topics.svelte.js';
	import type { DebateStatus } from '$lib/models/topic/topic.types.js';

	const statusLabel: Record<DebateStatus, string> = {
		pending: '未着手',
		surveying: '調査中',
		generating_personas: 'ペルソナ生成中',
		interviewing: '取材中',
		chapters_ready: '章立て準備中',
		chapters_approved: '章立て完了',
		cancelled: '討論停止',
		debating: '討論中',
		completed: '討論完了',
		published: '公開済み'
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
				<li class="topic-card">
					<a href={`/admin/topics/${topic.id}`}>
						<span class="title">{topic.title}</span>
						<span class="badge status-{topic.status}">{statusLabel[topic.status]}</span>
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
	.status-pending {
		background: #e0e0e0;
	}
	.status-surveying,
	.status-generating_personas,
	.status-interviewing,
	.status-debating {
		background: #bbdefb;
		color: #1565c0;
	}
	.status-chapters_ready,
	.status-chapters_approved {
		background: #fff9c4;
		color: #f57f17;
	}
	.status-cancelled {
		background: #ffcdd2;
		color: #b71c1c;
	}
	.status-completed {
		background: #c8e6c9;
		color: #2e7d32;
	}
	.status-published {
		background: #b39ddb;
		color: #4527a0;
	}
	.empty {
		color: #757575;
	}
</style>
