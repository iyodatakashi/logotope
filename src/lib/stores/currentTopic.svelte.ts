import { page } from '$app/state';
import { topicsStore } from '$lib/stores/topics.svelte';
import { createChaptersStore } from '$lib/stores/chapters.svelte';
import { createEditedChaptersStore } from '$lib/stores/editedChapters.svelte';
import { createEditorialStore } from '$lib/stores/editorial.svelte';
import { createChapterAnalysisStore } from '$lib/stores/chapterAnalysis.svelte';
import { createPersonasStore } from '$lib/stores/personas.svelte';
import { createEngagementsStore } from '$lib/stores/engagements.svelte';
import { createStakeholdersStore } from '$lib/stores/stakeholders.svelte';
import { createFactBaseStore } from '$lib/stores/factBase.svelte';

const create = () => {
	let factBaseStore = $state(createFactBaseStore(''));
	let chaptersStore = $state(createChaptersStore(''));
	let editedChaptersStore = $state(createEditedChaptersStore(''));
	let editorialStore = $state(createEditorialStore(''));
	let chapterAnalysisStore = $state(createChapterAnalysisStore(''));
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
		get editorialStore() {
			return editorialStore;
		},
		get chapterAnalysisStore() {
			return chapterAnalysisStore;
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
			const editorial = createEditorialStore(topicId);
			const analysis = createChapterAnalysisStore(topicId);
			const personas = createPersonasStore(topicId);
			const engagements = createEngagementsStore(topicId);
			const stakeholders = createStakeholdersStore(topicId);
			factBase.start();
			chapters.start();
			editedChapters.start();
			editorial.start();
			analysis.start();
			personas.start();
			engagements.start();
			stakeholders.start();
			factBaseStore = factBase;
			chaptersStore = chapters;
			editedChaptersStore = editedChapters;
			editorialStore = editorial;
			chapterAnalysisStore = analysis;
			personasStore = personas;
			engagementsStore = engagements;
			stakeholdersStore = stakeholders;
			return () => {
				factBase.stop();
				chapters.stop();
				editedChapters.stop();
				editorial.stop();
				analysis.stop();
				personas.stop();
				engagements.stop();
				stakeholders.stop();
			};
		}
	};
};

export const currentTopicStore = create();
