<script lang="ts">
	import Phase1Stakeholders from '$lib/features/admin/stakeholders/Phase1Stakeholders.svelte';
	import PhaseResetPanel from '$lib/sharedComponents/PhaseResetPanel.svelte';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
	import { page } from '$app/state';

	const topicId = page.params.topicId as string;
</script>

<Phase1Stakeholders
	{topicId}
	topicTitle={currentTopicStore.topic?.title ?? ''}
/>

{#if currentTopicStore.topic}
	<PhaseResetPanel
		phase={1}
		{topicId}
		discardSummary={[
			'生成済みのペルソナ（全件）',
			'ペルソナの取材記録と初期信念',
			'討論セッション（全ターン・章構成）'
		]}
		onReset={currentTopicStore.topic.resetToPhase1}
	/>
{/if}
