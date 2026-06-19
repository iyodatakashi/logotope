import { Timestamp } from 'firebase/firestore';
import type { Phase, PhaseStatus } from '$lib/models/phase/phase.types';

export type FetchedSourceContent = {
	url: string;
	content: string;
	fetchedAt: Timestamp;
};

export type TopicContext = {
	description?: string;
	sourceContents?: string[];
};

export type TopicBase = {
	id: string;
	title: string;
	description?: string;
	sourceUrls?: string[];
	fetchedSourceContents?: FetchedSourceContent[];
	sourceContentsFetchedAt?: Timestamp;
	phase: Phase;
	phaseStatus: PhaseStatus;
	stakeholders?: StakeholderDoc[];
	personaCount?: number;
};

export type TopicDoc = TopicBase & {
	createdAt: Timestamp;
	updatedAt: Timestamp;
	publishedAt?: Timestamp;
};

export type EngagementLevel = 'high' | 'medium' | 'low';

export type StakeholderDoc = {
	role: string;
	reason: string;
	mainInterests: string[];
	minorityLevel: string;
	engagementLevel?: EngagementLevel;
};
