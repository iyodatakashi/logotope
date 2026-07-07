import { Timestamp } from 'firebase/firestore';

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

export type EngagementLevel = 'high' | 'medium' | 'low';

export type PersonaForFirestore = {
	id: string;
	topicId: string;
	stakeholderRole: string;
	specificRole?: string;
	name: string;
	age: number;
	occupation: string;
	background: string;
	interests: string;
	engagementLevel?: EngagementLevel;
	approved: boolean;
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

export type PersonaData = {
	stakeholderRole: string;
	specificRole: string;
	name: string;
	nationality?: string;
	age: number;
	occupation: string;
	background: string;
	interests: string;
	engagementLevel?: EngagementLevel;
	llmType?: string;
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
