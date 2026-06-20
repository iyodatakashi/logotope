import { page } from '$app/state';
import { topicsStore } from '$lib/stores/topics.svelte';
import { createChaptersStore } from '$lib/stores/chapters.svelte';
import { createChapterAnalysisStore } from '$lib/stores/chapterAnalysis.svelte';
import { createPostDebateCommentsStore } from '$lib/stores/postDebateComments.svelte';
import { createPersonasStore } from '$lib/stores/personas.svelte';
import { createEngagementsStore } from '$lib/stores/engagements.svelte';

const create = () => {
	let chaptersStore = $state(createChaptersStore(''));
	let chapterAnalysisStore = $state(createChapterAnalysisStore(''));
	let postDebateCommentsStore = $state(createPostDebateCommentsStore(''));
	let personasStore = $state(createPersonasStore(''));
	let engagementsStore = $state(createEngagementsStore(''));

	return {
		get topic() {
			return topicsStore.topics.find((t) => t.id === page.params.topicId);
		},
		get chaptersStore() {
			return chaptersStore;
		},
		get chapterAnalysisStore() {
			return chapterAnalysisStore;
		},
		get postDebateCommentsStore() {
			return postDebateCommentsStore;
		},
		get personasStore() {
			return personasStore;
		},
		get engagementsStore() {
			return engagementsStore;
		},
		start(topicId: string) {
			const chapters = createChaptersStore(topicId);
			const analysis = createChapterAnalysisStore(topicId);
			const comments = createPostDebateCommentsStore(topicId);
			const personas = createPersonasStore(topicId);
			const engagements = createEngagementsStore(topicId);
			chapters.start();
			analysis.start();
			comments.start();
			personas.start();
			engagements.start();
			chaptersStore = chapters;
			chapterAnalysisStore = analysis;
			postDebateCommentsStore = comments;
			personasStore = personas;
			engagementsStore = engagements;
			return () => {
				chapters.stop();
				analysis.stop();
				comments.stop();
				personas.stop();
				engagements.stop();
			};
		}
	};
};

export const currentTopicStore = create();
