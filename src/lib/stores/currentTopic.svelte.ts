import { page } from '$app/state';
import { topicsStore } from '$lib/stores/topics.svelte.js';
import { createSessionStore } from '$lib/stores/session.svelte.js';
import { createPersonasStore } from '$lib/stores/personas.svelte.js';
import { createEngagementsStore } from '$lib/stores/engagements.svelte.js';

const create = () => {
	let sessionStore = $state(createSessionStore(''));
	let personasStore = $state(createPersonasStore(''));
	let engagementsStore = $state(createEngagementsStore(''));

	return {
		get topic() {
			return topicsStore.topics.find((t) => t.id === page.params.topicId);
		},
		get sessionStore() {
			return sessionStore;
		},
		get personasStore() {
			return personasStore;
		},
		get engagementsStore() {
			return engagementsStore;
		},
		start(topicId: string) {
			const s = createSessionStore(topicId);
			const p = createPersonasStore(topicId);
			const e = createEngagementsStore(topicId);
			s.start();
			p.start();
			e.start();
			sessionStore = s;
			personasStore = p;
			engagementsStore = e;
			return () => {
				s.stop();
				p.stop();
				e.stop();
			};
		}
	};
};

export const currentTopicStore = create();
