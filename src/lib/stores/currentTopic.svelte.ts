import { page } from '$app/state';
import { topicsStore } from '$lib/stores/topics.svelte';
import { createChaptersStore } from '$lib/stores/chapters.svelte';
import { createEditedChaptersStore } from '$lib/stores/editedChapters.svelte';
import { createEditedIntroClosingStore } from '$lib/stores/editedIntroClosing.svelte';
import { createChapterAnalysisStore } from '$lib/stores/chapterAnalysis.svelte';
import { createPostDebateCommentsStore } from '$lib/stores/postDebateComments.svelte';
import { createEditedPostDebateCommentsStore } from '$lib/stores/editedPostDebateComments.svelte';
import { createPersonasStore } from '$lib/stores/personas.svelte';
import { createEngagementsStore } from '$lib/stores/engagements.svelte';
import { createStakeholdersStore } from '$lib/stores/stakeholders.svelte';
import { createFactBaseStore } from '$lib/stores/factBase.svelte';

const create = () => {
	let factBaseStore = $state(createFactBaseStore(''));
	let chaptersStore = $state(createChaptersStore(''));
	let editedChaptersStore = $state(createEditedChaptersStore(''));
	let editedIntroClosingStore = $state(createEditedIntroClosingStore(''));
	let chapterAnalysisStore = $state(createChapterAnalysisStore(''));
	let postDebateCommentsStore = $state(createPostDebateCommentsStore(''));
	let editedPostDebateCommentsStore = $state(createEditedPostDebateCommentsStore(''));
	let personasStore = $state(createPersonasStore(''));
	let engagementsStore = $state(createEngagementsStore(''));
	let stakeholdersStore = $state(createStakeholdersStore(''));

	return {
		get topic() {
			return topicsStore.topics.find((topic) => topic.id === page.params.topicId);
		},
		get factBaseStore() {
			return factBaseStore;
		},
		get chaptersStore() {
			return chaptersStore;
		},
		get editedChaptersStore() {
			return editedChaptersStore;
		},
		get editedIntroClosingStore() {
			return editedIntroClosingStore;
		},
		get chapterAnalysisStore() {
			return chapterAnalysisStore;
		},
		get postDebateCommentsStore() {
			return postDebateCommentsStore;
		},
		get editedPostDebateCommentsStore() {
			return editedPostDebateCommentsStore;
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
		start(topicId: string) {
			const factBase = createFactBaseStore(topicId);
			const chapters = createChaptersStore(topicId);
			const editedChapters = createEditedChaptersStore(topicId);
			const editedIntroClosing = createEditedIntroClosingStore(topicId);
			const analysis = createChapterAnalysisStore(topicId);
			const comments = createPostDebateCommentsStore(topicId);
			const editedComments = createEditedPostDebateCommentsStore(topicId);
			const personas = createPersonasStore(topicId);
			const engagements = createEngagementsStore(topicId);
			const stakeholders = createStakeholdersStore(topicId);
			factBase.start();
			chapters.start();
			editedChapters.start();
			editedIntroClosing.start();
			analysis.start();
			comments.start();
			editedComments.start();
			personas.start();
			engagements.start();
			stakeholders.start();
			factBaseStore = factBase;
			chaptersStore = chapters;
			editedChaptersStore = editedChapters;
			editedIntroClosingStore = editedIntroClosing;
			chapterAnalysisStore = analysis;
			postDebateCommentsStore = comments;
			editedPostDebateCommentsStore = editedComments;
			personasStore = personas;
			engagementsStore = engagements;
			stakeholdersStore = stakeholders;
			return () => {
				factBase.stop();
				chapters.stop();
				editedChapters.stop();
				editedIntroClosing.stop();
				analysis.stop();
				comments.stop();
				editedComments.stop();
				personas.stop();
				engagements.stop();
				stakeholders.stop();
			};
		}
	};
};

export const currentTopicStore = create();
