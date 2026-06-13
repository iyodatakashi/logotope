<script lang="ts">
	import { Button } from '@14ch/svelte-ui';
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';

	interface Props {
		topicId: string;
	}
	let { topicId }: Props = $props();

	let generating = $state(false);
	let error = $state('');

	const chapters = $derived(currentTopicStore.sessionStore.session?.chapters ?? null);
	const hasChapters = $derived(!!chapters?.length);
	const chapterIssues = $derived(currentTopicStore.sessionStore.session?.chapterIssues ?? null);

	async function handleApprove() {
		await currentTopicStore.topic?.approveChapters();
		goto(`/admin/topics/${topicId}/debate`);
	}

	async function handleGenerate() {
		generating = true;
		error = '';
		try {
			await currentTopicStore.topic?.generateChapters();
		} catch (e) {
			error = e instanceof Error ? e.message : '生成に失敗しました';
		} finally {
			generating = false;
		}
	}
</script>

<section>
	<h2>フェーズ 4: 章立て</h2>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if generating}
		<p class="status" role="status">章立てを生成中...</p>
	{:else if !hasChapters}
		<p class="hint">取材結果をもとに討論の章立てを生成します。</p>
		<div class="actions">
			<Button onclick={handleGenerate}>章立てを生成</Button>
		</div>
	{:else}
		<ol class="chapters">
			{#each chapters! as chapter}
				<li>
					<strong>{chapter.title}</strong>
					<span class="focus">{chapter.focusQuestion}</span>
				</li>
			{/each}
		</ol>
		<div class="actions">
			<Button variant="outlined" onclick={handleGenerate}>章立てを再生成</Button>
			<Button onclick={handleApprove}>章立てを承認</Button>
		</div>

		{#if chapterIssues}
			<details class="issues-debug">
				<summary>Step 1 切り口（検証用）</summary>
				<div class="issues-grid">
					<div class="issues-col">
						<h4>一般的な切り口（ペルソナなし）</h4>
						<ol>
							{#each chapterIssues.general as issue}
								<li>{issue}</li>
							{/each}
						</ol>
					</div>
					<div class="issues-col">
						<h4>ペルソナ固有の切り口</h4>
						<ol>
							{#each chapterIssues.persona as issue}
								<li>{issue}</li>
							{/each}
						</ol>
					</div>
				</div>
			</details>
		{/if}
	{/if}
</section>

<style>
	section {
		padding: 16px;
	}
	.hint {
		color: #555;
		margin-bottom: 16px;
	}
	.status {
		color: #1565c0;
		font-style: italic;
	}
	.error {
		color: #c62828;
		font-weight: 600;
		margin-bottom: 12px;
	}
	.chapters {
		margin: 16px 0;
		padding-left: 24px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.chapters li {
		line-height: 1.5;
	}
	.focus {
		display: block;
		color: #757575;
		font-size: 0.875rem;
		margin-top: 2px;
	}
	.actions {
		display: flex;
		gap: 8px;
		margin-top: 16px;
		flex-wrap: wrap;
	}
	.issues-debug {
		margin-top: 24px;
		border: 1px solid #e0e0e0;
		border-radius: 6px;
		padding: 0 12px;
	}
	.issues-debug summary {
		padding: 10px 0;
		cursor: pointer;
		font-size: 0.875rem;
		color: #757575;
		user-select: none;
	}
	.issues-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
		padding-bottom: 12px;
	}
	.issues-col h4 {
		font-size: 0.8rem;
		color: #555;
		margin: 0 0 8px;
		font-weight: 600;
	}
	.issues-col ol {
		margin: 0;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.issues-col li {
		font-size: 0.8rem;
		color: #444;
		line-height: 1.5;
	}
</style>
