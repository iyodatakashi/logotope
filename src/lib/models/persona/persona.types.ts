import { Timestamp } from 'firebase/firestore';
import type { EngagementLevel } from '$lib/models/stakeholder/stakeholder.types';

// 不変の信念のみ（interview が version 0 を書き、討論は上書きしない）
export type BeliefForFirestore = {
	id: string;
	version: number;
	content: string;
	createdAt: Timestamp;
};

export type Belief = Omit<BeliefForFirestore, 'createdAt'> & { createdAt: Date };

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

export type Awareness = Omit<AwarenessForFirestore, 'createdAt'> & { createdAt: Date };

export type SearchResult = { title: string; url: string };
export type SearchSource = { query: string; summary: string; results: SearchResult[] };

export type DraftBelief = {
	stanceAndGrounds: string;
	coreClaims: string;
	concerns: string;
	values: string;
	compromisePoints: string;
	changePotential: string;
};

export type InterviewForFirestore = {
	researchSummary?: string;
	draftBelief?: DraftBelief;
	verificationReport?: string;
	interviewRecord?: string;
	sources?: SearchSource[];
	status: 'queued' | 'in_progress' | 'completed' | 'error';
	errorMessage?: string;
	completedAt?: Timestamp;
};

export type Interview = Omit<InterviewForFirestore, 'completedAt'> & { completedAt?: Date };

export type PersonaForFirestore = {
	id: string;
	topicId: string;
	stakeholderRole: string;
	// 由来ステークホルダーの安定 id。永続時に必ず付与される。
	stakeholderId: string;
	specificRole?: string;
	name: string;
	age: number;
	occupation: string;
	background: string;
	interests: string;
	engagementLevel?: EngagementLevel;
	// 討論参加の採用選択。生成時に true を焼き込み、以降ペルソナ単位で切替可能。
	selected: boolean;
	sortOrder: number;
	interview?: InterviewForFirestore;
	beliefs: BeliefForFirestore[];
	awarenesses?: AwarenessForFirestore[];
};

export type Persona = Omit<PersonaForFirestore, 'interview' | 'beliefs' | 'awarenesses'> & {
	interview?: Interview;
	beliefs: Belief[];
	awarenesses?: Awareness[];
};

export type PersonaForInterview = {
	name: string;
	age: number;
	occupation: string;
	stakeholderRole: string;
	specificRole: string;
	background: string;
	interests: string;
};
