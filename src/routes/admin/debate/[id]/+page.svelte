<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { onAuthStateChanged } from 'firebase/auth';
	import { auth } from '$lib/firebase.js';
	import { createProgressStore } from '$lib/stores/progress.svelte.js';
	import { createTopicStore } from '$lib/stores/topic.svelte.js';
	import Phase1Stakeholders from '$lib/components/admin/Phase1Stakeholders.svelte';
	import Phase2Personas from '$lib/components/admin/Phase2Personas.svelte';
	import Phase3Interviews from '$lib/components/admin/Phase3Interviews.svelte';
	import Phase4Debate from '$lib/components/admin/Phase4Debate.svelte';

	const topicId = page.params.id as string;
	const topicStore = createTopicStore(topicId);
	const progressStore = createProgressStore(topicId);

	const status = $derived(topicStore.topic?.status ?? '');
	const topicTitle = $derived(topicStore.topic?.title ?? '');

	onMount(() => {
		const unsubAuth = onAuthStateChanged(auth, (user) => {
			if (user) {
				topicStore.start();
				progressStore.start();
			}
		});
		return () => {
			unsubAuth();
			topicStore.stop();
			progressStore.stop();
		};
	});
</script>

<div class="page">
	<a href="/admin">← ダッシュボードへ戻る</a>

	{#if topicTitle}
		<h1>{topicTitle}</h1>
	{/if}

	{#if !status}
		<p class="loading">読み込み中...</p>
	{:else if status === 'pending' || status === 'surveying'}
		<Phase1Stakeholders {topicId} {topicTitle} />
	{:else if status === 'generating_personas'}
		<Phase2Personas {topicId} {topicTitle} />
	{:else if status === 'interviewing'}
		<Phase3Interviews {topicId} {topicTitle} />
	{:else if status === 'debating' || status === 'completed' || status === 'published'}
		<Phase4Debate {topicId} {topicTitle} />
	{:else}
		<p class="loading">読み込み中...</p>
	{/if}
</div>

<style>
	.page { max-width: 800px; margin: 0 auto; padding: 24px; }
	a { color: #1565c0; text-decoration: none; }
	.loading { color: #555; font-style: italic; }
</style>
