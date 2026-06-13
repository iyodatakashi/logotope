import { Timestamp } from 'firebase/firestore';
import type { Phase, PhaseStatus } from '$lib/utils/phase.js';

// 旧トピックステータス。新規データは (phase, phaseStatus) を使い、これは既存データの互換読み取り専用。
export type DebateStatus =
	| 'pending'
	| 'surveying'
	| 'generating_personas'
	| 'interviewing'
	| 'chapters_ready'
	| 'chapters_approved'
	| 'debating'
	| 'cancelled'
	| 'completed'
	| 'published';

export type TopicSummary = {
	id: string;
	title: string;
	status: DebateStatus;
	phase?: Phase;
	phaseStatus?: PhaseStatus;
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
	stanceDirection: string;
	minorityLevel: string;
	engagementLevel?: EngagementLevel;
};

export type TopicDoc = {
	id: string;
	title: string;
	status: DebateStatus;
	phase?: Phase;
	phaseStatus?: PhaseStatus;
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
