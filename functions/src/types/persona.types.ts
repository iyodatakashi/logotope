import type { EngagementLevel } from './stakeholder.types.js';
import type { LLMType } from './common.types.js';

export type Persona = {
	id: string;
	topicId: string;
	name: string;
	age: number;
	occupation: string;
	stakeholderRole: string;
	specificRole: string;
	background: string;
	interests: string;
	nationality: string;
	engagementLevel: EngagementLevel;
	llmType: LLMType;
	approved: boolean;
	sortOrder: number;
	beliefs?: Belief[];
	interviewRecord?: string;
};

import type { Timestamp } from 'firebase-admin/firestore';

export type Belief = {
	id: string;
	version: number;
	content: string;
	createdAt: Timestamp;
	changeType?: string | null;
	changeSummary?: string | null;
	triggeredByTurnId?: string | null;
};
