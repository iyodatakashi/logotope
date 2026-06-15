<script lang="ts">
	import { goto } from '$app/navigation';
	import { topicsStore } from '$lib/stores/topics.svelte';
	import TopicForm from '$lib/features/admin/new-topic/TopicForm.svelte';

	let submitting = $state(false);
	let error = $state('');

	async function handleSubmit(title: string) {
		submitting = true;
		error = '';
		try {
			const topicId = await topicsStore.addTopic(title);
			goto(`/admin/topics/${topicId}`);
		} catch {
			error = 'テーマの作成に失敗しました。再試行してください。';
			submitting = false;
		}
	}
</script>

<div class="page">
	<a href="/admin/topics">← ダッシュボードへ戻る</a>
	<h1>新しいテーマを作成</h1>
	{#if error}
		<p role="alert" class="error">{error}</p>
	{/if}
	<TopicForm onSubmit={handleSubmit} loading={submitting} />
</div>

<style>
	.page {
		max-width: 600px;
		margin: 0 auto;
		padding: 24px;
	}
	a {
		color: #1565c0;
		text-decoration: none;
		display: inline-block;
		margin-bottom: 16px;
	}
	.error {
		color: #d32f2f;
		margin-bottom: 16px;
	}
</style>
