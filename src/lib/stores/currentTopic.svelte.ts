import { page } from '$app/state';
import { topicsStore } from '$lib/stores/topics.svelte';
import { createChaptersStore } from '$lib/stores/chapters.svelte';
import { createEditedChaptersStore } from '$lib/stores/editedChapters.svelte';
import { createChapterAnalysisStore } from '$lib/stores/chapterAnalysis.svelte';
import { createPostDebateCommentsStore } from '$lib/stores/postDebateComments.svelte';
import { createPersonasStore } from '$lib/stores/personas.svelte';
import { createEngagementsStore } from '$lib/stores/engagements.svelte';
import { createStakeholdersStore } from '$lib/stores/stakeholders.svelte';
import { createFactCheckStore } from '$lib/stores/factCheck.svelte';

const create = () => {
	let chaptersStore = $state(createChaptersStore(''));
	let editedChaptersStore = $state(createEditedChaptersStore(''));
	let chapterAnalysisStore = $state(createChapterAnalysisStore(''));
	let postDebateCommentsStore = $state(createPostDebateCommentsStore(''));
	let personasStore = $state(createPersonasStore(''));
	let engagementsStore = $state(createEngagementsStore(''));
	let stakeholdersStore = $state(createStakeholdersStore(''));
	let factCheckStore = $state(createFactCheckStore(''));

	return {
		get topic() {
			return topicsStore.topics.find((t) => t.id === page.params.topicId);
		},
		get chaptersStore() {
			return chaptersStore;
		},
		get editedChaptersStore() {
			return editedChaptersStore;
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
		get stakeholdersStore() {
			return stakeholdersStore;
		},
		get factCheckStore() {
			return factCheckStore;
		},
		start(topicId: string) {
			const chapters = createChaptersStore(topicId);
			const editedChapters = createEditedChaptersStore(topicId);
			const analysis = createChapterAnalysisStore(topicId);
			const comments = createPostDebateCommentsStore(topicId);
			const personas = createPersonasStore(topicId);
			const engagements = createEngagementsStore(topicId);
			const stakeholders = createStakeholdersStore(topicId);
			const factCheck = createFactCheckStore(topicId);
			chapters.start();
			editedChapters.start();
			analysis.start();
			comments.start();
			personas.start();
			engagements.start();
			stakeholders.start();
			factCheck.start();
			chaptersStore = chapters;
			editedChaptersStore = editedChapters;
			chapterAnalysisStore = analysis;
			postDebateCommentsStore = comments;
			personasStore = personas;
			engagementsStore = engagements;
			stakeholdersStore = stakeholders;
			factCheckStore = factCheck;
			return () => {
				chapters.stop();
				editedChapters.stop();
				analysis.stop();
				comments.stop();
				personas.stop();
				engagements.stop();
				stakeholders.stop();
				factCheck.stop();
			};
		}
	};
};

export const currentTopicStore = create();
