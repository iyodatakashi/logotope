import type { EngagementLevel } from './stakeholder.types.js';

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
	approved: boolean;
	sortOrder: number;
	beliefs?: Belief[];
	awarenesses?: AwarenessForFirestore[];
	interviewRecord?: string;
};

import type { Timestamp } from 'firebase-admin/firestore';

// 不変の信念のみ（interview が version 0 を書き、討論は上書きしない）
export type Belief = {
	id: string;
	version: number;
	content: string;
	createdAt: Timestamp;
};

// 他者視点の受容（reception）か自己発の気づき（self）か
export type AwarenessKind = 'reception' | 'self';

// 討論中の気づき（追記のみ・非破壊）。ターンに帰属し、reception は由来ペルソナを持つ
export type AwarenessForFirestore = {
	id: string;
	kind: AwarenessKind;
	content: string;
	sourcePersonaId: string | null;
	triggeredByTurnId: string;
	createdAt: Timestamp;
};
