import { page } from '$app/state';
import { topicsStore } from '$lib/stores/topics.svelte';

const create = () => {
	return {
		get topic() {
			const topicId = page.params.topicId;
			const currentTopic = topicsStore.topics.find((topic) => topic.id === topicId);
			console.log(currentTopic);
			return currentTopic;
		}
	};
};

export const currentTopicStore = create();
