<script lang="ts">
	import Phase5Debate from '$lib/features/admin/debate/Phase5Debate.svelte';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
	import { page } from '$app/state';

	const topicId = page.params.topicId as string;
</script>

<Phase5Debate {topicId} topicTitle={currentTopicStore.topic?.title ?? ''} />
