<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { createTopicStore } from '$lib/stores/topic.svelte.js';
	import { PHASE_DEFS, phasePath, statusToPhase, type Phase } from '$lib/utils/phase.js';
	import StepNav from '$lib/components/admin/StepNav.svelte';
	import { setPhasePageContext } from './phase-context.js';

	let { children }: { children: Snippet } = $props();

	const topicId = page.params.id as string;
	const topicStore = createTopicStore(topicId);

	const currentPhase = $derived<Phase>(
		topicStore.topic ? statusToPhase(topicStore.topic.status) : 1
	);

	// 現在URLのフェーズ（/admin/debate/[id] 直下のリダイレクトページでは null）
	const pagePhase = $derived.by<Phase | null>(() => {
		const slug = page.route.id?.split('/').at(-1);
		return PHASE_DEFS.find((d) => d.slug === slug)?.phase ?? null;
	});

	setPhasePageContext({
		topicId,
		get topic() {
			return topicStore.topic;
		},
		get currentPhase() {
			return currentPhase;
		},
		topicStore,
		pageModeFor: (pagePhase) => (pagePhase < currentPhase ? 'view' : 'active')
	});

	onMount(() => {
		topicStore.start();
		return () => topicStore.stop();
	});

	// 未到達フェーズへのアクセスのみ現在フェーズへリダイレクト（到達済みフェーズの閲覧では遷移しない）
	$effect(() => {
		if (topicStore.topic && pagePhase !== null && pagePhase > currentPhase) {
			goto(phasePath(topicId, currentPhase), { replaceState: true });
		}
	});
</script>

<div class="page">
	<a href="/admin">← ダッシュボードへ戻る</a>

	{#if !topicStore.isLoaded}
		<p class="loading">読み込み中...</p>
	{:else if !topicStore.topic}
		<div class="not-found">
			<h1>テーマが見つかりません</h1>
			<p>指定されたテーマは存在しないか、削除された可能性があります。</p>
			<a href="/admin">ダッシュボードへ戻る</a>
		</div>
	{:else}
		<h1>{topicStore.topic.title}</h1>
		<StepNav {topicId} {currentPhase} />
		{#if pagePhase === null || pagePhase <= currentPhase}
			{@render children()}
		{/if}
	{/if}
</div>

<style>
	.page { max-width: 800px; margin: 0 auto; padding: 24px; }
	a { color: #1565c0; text-decoration: none; }
	.loading { color: #555; font-style: italic; }
	.not-found { margin-top: 24px; }
	.not-found p { color: #555; margin: 8px 0 16px; }
</style>
