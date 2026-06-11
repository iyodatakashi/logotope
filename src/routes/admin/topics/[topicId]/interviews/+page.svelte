<script lang="ts">
	import Phase3Interviews from '$lib/features/admin/research/Phase3Interviews.svelte';
	import PhaseResetPanel from '$lib/sharedComponents/PhaseResetPanel.svelte';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
	import { page } from '$app/state';

	const topicId = page.params.topicId as string;
</script>

<Phase3Interviews
	{topicId}
	topicTitle={currentTopicStore.topic?.title ?? ''}
/>

{#if currentTopicStore.topic}
	<PhaseResetPanel
		phase={3}
		{topicId}
		discardSummary={['討論セッション（全ターン・章構成・討論後コメント）']}
		onReset={currentTopicStore.topic.resetToPhase3}
	/>
{/if}
