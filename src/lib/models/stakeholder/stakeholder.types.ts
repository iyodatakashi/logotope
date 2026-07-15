export type EngagementLevel = 'high' | 'medium' | 'low';

export type StakeholderForFirestore = {
	// サーバが生成時に付番する安定 id。ペルソナの由来対応づけの突合キーとなる。
	id: string;
	role: string;
	reason: string;
	mainInterests: string[];
	minorityLevel: string;
	engagementLevel?: EngagementLevel;
};

// ステークホルダーは採用選択を持たない中間生成物。表示専用のためアプリ層でも永続形と同一。
export type Stakeholder = StakeholderForFirestore;
