// 永続形（stakeholders/0 の配列要素）。id はサーバが生成時に付番する安定識別子で、
// 配列位置に依存しない。ペルソナの由来対応づけ・採用選択の唯一の突合キーとなる。
export type Stakeholder = {
	id: string;
	role: string;
	reason: string;
	mainInterests: string[];
	minorityLevel: MinorityLevel;
	engagementLevel?: EngagementLevel;
};

export type MinorityLevel = 'high' | 'medium' | 'low';
export type EngagementLevel = 'high' | 'medium' | 'low';
