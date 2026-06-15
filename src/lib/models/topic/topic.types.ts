import { Timestamp } from 'firebase/firestore';
import type { Phase, PhaseStatus } from '$lib/models/phase/phase.types';

export type TopicBase = {
	id: string;
	title: string;
	phase: Phase;
	phaseStatus: PhaseStatus;
	stakeholders?: {
		items: StakeholderDoc[];
		approved: boolean;
	};
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
