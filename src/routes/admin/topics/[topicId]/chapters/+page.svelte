<script lang="ts">
	import Phase4Chapters from '$lib/features/admin/debate/Phase4Chapters.svelte';
	import PhaseResetPanel from '$lib/sharedComponents/PhaseResetPanel.svelte';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
	import { page } from '$app/state';

	const topicId = page.params.topicId as string;
</script>

<Phase4Chapters {topicId} />

{#if currentTopicStore.topic}
	<PhaseResetPanel
		phase={3}
		{topicId}
		discardSummary={['章立て・討論セッション（全ターン・討論後コメント）']}
		onReset={currentTopicStore.topic.resetToPhase3}
	/>
{/if}
