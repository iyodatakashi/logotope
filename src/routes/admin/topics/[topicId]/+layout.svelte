<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import { PHASE_DEFS, phasePath, type Phase } from '$lib/utils/phase.js';
	import StepNav from '$lib/sharedComponents/StepNav.svelte';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
	import { topicsStore } from '$lib/stores/topics.svelte.js';

	let { children }: { children: Snippet } = $props();

	const topicId = page.params.topicId as string;

	$effect(() => {
		return currentTopicStore.start(page.params.topicId as string);
	});

	const currentPhase = $derived<Phase>(currentTopicStore.topic?.phase ?? 1);

	// 現在URLのフェーズ（/admin/topics/[id] 直下のリダイレクトページでは null）
	const pagePhase = $derived.by(() => {
		const slug = page.route.id?.split('/').at(-1);
		return PHASE_DEFS.find((d) => d.slug === slug)?.phase ?? null;
	});

	// 未到達フェーズへのアクセスのみ現在フェーズへリダイレクト（到達済みフェーズの閲覧では遷移しない）
	$effect(() => {
		if (currentTopicStore.topic && pagePhase !== null && pagePhase > currentPhase) {
			goto(phasePath(topicId, currentPhase), { replaceState: true });
		}
	});
</script>

<div class="page">
	<a href="/admin/topics">← ダッシュボードへ戻る</a>

	{#if !topicsStore.isLoaded}
		<p class="loading">読み込み中...</p>
	{:else if !currentTopicStore.topic}
		<div class="not-found">
			<h1>テーマが見つかりません</h1>
			<p>指定されたテーマは存在しないか、削除された可能性があります。</p>
			<a href="/admin/topics">ダッシュボードへ戻る</a>
		</div>
	{:else}
		<h1>{currentTopicStore.topic.title}</h1>
		<StepNav {topicId} {currentPhase} />
		{#if pagePhase === null || pagePhase <= currentPhase}
			{@render children()}
		{/if}
	{/if}
</div>

<style>
	.page {
		max-width: 800px;
		margin: 0 auto;
		padding: 24px;
	}
	a {
		color: #1565c0;
		text-decoration: none;
	}
	.loading {
		color: #555;
		font-style: italic;
	}
	.not-found {
		margin-top: 24px;
	}
	.not-found p {
		color: #555;
		margin: 8px 0 16px;
	}
</style>
