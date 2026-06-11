<script lang="ts">
	import Phase4Debate from '$lib/features/admin/debate/Phase4Debate.svelte';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
	import { page } from '$app/state';

	const topicId = page.params.topicId as string;
</script>

<Phase4Debate {topicId} topicTitle={currentTopicStore.topic?.title ?? ''} />
