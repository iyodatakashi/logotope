import { Timestamp } from 'firebase/firestore';
import type { Phase, PhaseStatus } from '$lib/models/phase/phase.types';

export type FetchedSourceContentForFirestore = {
	url: string;
	content: string;
	fetchedAt: Timestamp;
};

export type FetchedSourceContent = Omit<FetchedSourceContentForFirestore, 'fetchedAt'> & {
	fetchedAt: Date;
};

export type TopicContext = {
	description?: string;
	sourceContents?: string[];
};

type TopicBaseForFirestore = {
	id: string;
	title: string;
	description?: string;
	sourceUrls?: string[];
	fetchedSourceContents?: FetchedSourceContentForFirestore[];
	sourceContentsFetchedAt?: Timestamp;
	phase: Phase;
	phaseStatus: PhaseStatus;
	personaCount?: number;
};

export type TopicForFirestore = TopicBaseForFirestore & {
	createdAt: Timestamp;
	updatedAt: Timestamp;
	publishedAt?: Timestamp;
};

export type EngagementLevel = 'high' | 'medium' | 'low';

export type StakeholderForFirestore = {
	role: string;
	reason: string;
	mainInterests: string[];
	minorityLevel: string;
	engagementLevel?: EngagementLevel;
};
