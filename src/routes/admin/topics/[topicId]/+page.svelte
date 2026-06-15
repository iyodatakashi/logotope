<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { phasePath } from '$lib/models/phase/phase';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { topicsStore } from '$lib/stores/topics.svelte';

	const topicId = page.params.topicId as string;

	// 旧URL（トピック直下）は現在フェーズのURLへ置換リダイレクト（ストアロード完了後に判定）
	$effect(() => {
		if (topicsStore.isLoaded && currentTopicStore.topic) {
			goto(phasePath(topicId, currentTopicStore.topic.phase), { replaceState: true });
		}
	});
</script>
