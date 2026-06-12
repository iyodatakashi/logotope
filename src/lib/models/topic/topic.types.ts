import { Timestamp } from 'firebase/firestore';

export type DebateStatus =
	| 'pending'
	| 'surveying'
	| 'generating_personas'
	| 'interviewing'
	| 'debating'
	| 'cancelled'
	| 'completed'
	| 'published';

export type TopicSummary = {
	id: string;
	title: string;
	status: DebateStatus;
	createdAt: string;
};

export type PublishedDebateSummary = {
	id: string;
	topicTitle: string;
	personaCount: number;
	publishedAt: string;
};

export type StakeholderDoc = {
	role: string;
	reason: string;
	mainInterests: string[];
	stanceDirection: string;
	minorityLevel: string;
};

export type TopicDoc = {
	id: string;
	title: string;
	status: DebateStatus;
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
