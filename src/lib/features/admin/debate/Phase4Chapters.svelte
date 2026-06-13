<script lang="ts">
	import { Button } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';

	interface Props {
		topicId: string;
	}
	let { topicId }: Props = $props();

	let generating = $state(false);
	let error = $state('');

	const chapters = $derived(currentTopicStore.sessionStore.session?.chapters ?? null);
	const hasChapters = $derived(!!chapters?.length);

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
			<Button href="/admin/topics/{topicId}/debate">討論フェーズへ進む</Button>
			<Button variant="outlined" onclick={handleGenerate}>章立てを再生成</Button>
		</div>
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
</style>
