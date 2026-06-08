<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { onAuthStateChanged } from 'firebase/auth';
	import { auth } from '$lib/firebase.js';
	import { createProgressStore } from '$lib/stores/progress.svelte.js';
	import Phase1Stakeholders from '$lib/components/admin/Phase1Stakeholders.svelte';
	import Phase2Personas from '$lib/components/admin/Phase2Personas.svelte';
	import Phase3Interviews from '$lib/components/admin/Phase3Interviews.svelte';
	import Phase4Debate from '$lib/components/admin/Phase4Debate.svelte';
	import { getTopic } from '$lib/api/topics.js';

	const topicId = page.params.id as string;
	const progressStore = createProgressStore(topicId);

	let topicTitle = $state('');

	const status = $derived(progressStore.progress?.status ?? '');

	onMount(() => {
		const unsubAuth = onAuthStateChanged(auth, async (user) => {
			if (user) {
				progressStore.start();
				const topic = await getTopic(topicId);
				topicTitle = topic.title;
			}
		});
		return () => {
			unsubAuth();
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
	{:else if status === 'debating' || status === 'completed'}
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
