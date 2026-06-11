import { getContext, setContext } from 'svelte';
import type { TopicDoc } from '$lib/types/index.js';
import type { Phase } from '$lib/utils/phase.js';
import type { createTopicStore } from '$lib/stores/topic.svelte.js';

export type PageMode = 'active' | 'view';

export interface PhasePageContext {
	topicId: string;
	readonly topic: TopicDoc | null;
	readonly currentPhase: Phase;
	topicStore: ReturnType<typeof createTopicStore>;
	pageModeFor: (pagePhase: Phase) => PageMode;
}

const KEY = 'phase-page';

export const setPhasePageContext = (ctx: PhasePageContext): PhasePageContext =>
	setContext(KEY, ctx);

export const getPhasePageContext = (): PhasePageContext => getContext(KEY);
