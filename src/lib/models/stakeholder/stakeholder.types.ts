export type EngagementLevel = 'high' | 'medium' | 'low';

export type StakeholderForFirestore = {
	// サーバが生成時に付番する安定 id。
	id: string;
	role: string;
	reason: string;
	mainInterests: string[];
	minorityLevel: string;
	engagementLevel?: EngagementLevel;
	// 採用チェックの ON/OFF。未設定（サーバ生成直後）は既定 ON として扱う。
	selected?: boolean;
};

// Firestoreから読み込んだ後のアプリ層型（id 解決済み）
export type Stakeholder = StakeholderForFirestore & {
	id: string;
};
