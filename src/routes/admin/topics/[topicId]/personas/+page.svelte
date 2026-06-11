<script lang="ts">
	import Phase2Personas from '$lib/features/admin/personas/Phase2Personas.svelte';
	import PhaseResetPanel from '$lib/sharedComponents/PhaseResetPanel.svelte';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
	import { page } from '$app/state';

	const topicId = page.params.topicId as string;
</script>

<Phase2Personas
	{topicId}
	topicTitle={currentTopicStore.topic?.title ?? ''}
/>

{#if currentTopicStore.topic}
	<PhaseResetPanel
		phase={2}
		{topicId}
		discardSummary={['ペルソナの取材記録と初期信念', '討論セッション（全ターン・章構成）']}
		onReset={currentTopicStore.topic.resetToPhase2}
	/>
{/if}
