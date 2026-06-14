import { Timestamp } from 'firebase/firestore';
import type { Phase, PhaseStatus } from '$lib/utils/phase.js';

export type TopicSummary = {
	id: string;
	title: string;
	phase: Phase;
	phaseStatus: PhaseStatus;
	createdAt: string;
};

export type PublishedDebateSummary = {
	id: string;
	topicTitle: string;
	personaCount: number;
	publishedAt: string;
};

export type EngagementLevel = 'high' | 'medium' | 'low';

export type StakeholderDoc = {
	role: string;
	reason: string;
	mainInterests: string[];
	minorityLevel: string;
	engagementLevel?: EngagementLevel;
};

export type TopicDoc = {
	id: string;
	title: string;
	phase: Phase;
	phaseStatus: PhaseStatus;
	createdAt: Timestamp;
	updatedAt: Timestamp;
	publishedAt?: Timestamp;
	personaCount?: number;
	stakeholders?: {
		items: StakeholderDoc[];
		approved: boolean;
		createdAt: Timestamp;
	};
};
