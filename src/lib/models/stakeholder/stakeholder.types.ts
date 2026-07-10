import type { EngagementLevel } from '$lib/models/topic/topic.types';

export type StakeholderForFirestore = {
	// サーバが生成時に付番する安定 id。
	id: string;
	role: string;
	reason: string;
	mainInterests: string[];
	minorityLevel: string;
	engagementLevel?: EngagementLevel;
};

// Firestoreから読み込んだ後のアプリ層型（id 解決済み）
export type Stakeholder = StakeholderForFirestore & {
	id: string;
};
