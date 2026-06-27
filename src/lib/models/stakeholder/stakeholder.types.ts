import type { EngagementLevel } from '$lib/models/topic/topic.types';

export type StakeholderForFirestore = {
	role: string;
	reason: string;
	mainInterests: string[];
	minorityLevel: string;
	engagementLevel?: EngagementLevel;
};

// Firestoreから読み込んだ後のアプリ層型（id 付与済み）
export type Stakeholder = StakeholderForFirestore & {
	id: string;
};
