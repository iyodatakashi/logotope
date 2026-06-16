export type Stakeholder = {
	role: string;
	reason: string;
	mainInterests: string[];
	minorityLevel: MinorityLevel;
	engagementLevel?: EngagementLevel;
};

export type StakeholderMap = {
	id: string;
	topicId: string;
	content: string;
};

export type MinorityLevel = 'high' | 'medium' | 'low';
export type EngagementLevel = 'high' | 'medium' | 'low';
