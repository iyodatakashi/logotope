<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { phasePath, statusToPhase } from '$lib/utils/phase.js';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';

	const topicId = page.params.topicId as string;

	// 旧URL（トピック直下）は現在フェーズのURLへ置換リダイレクト
	$effect(() => {
		if (currentTopicStore.topic) {
			goto(phasePath(topicId, statusToPhase(currentTopicStore.topic.status)), { replaceState: true });
		}
	});
</script>
