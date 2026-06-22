import { Timestamp } from 'firebase/firestore';

export type BeliefChangeType = 'opinion_change' | 'partial_acceptance';

export type BeliefForFirestore = {
	id: string;
	version: number;
	content: string;
	changeType?: BeliefChangeType;
	changeSummary?: string;
	triggeredByTurnId?: string;
	createdAt: Timestamp;
};

export type Belief = Omit<BeliefForFirestore, 'createdAt'> & { createdAt: Date };

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
};

export type Persona = Omit<PersonaForFirestore, 'interview' | 'beliefs'> & {
	interview?: Interview;
	beliefs: Belief[];
};

export type PersonaBeliefVersion = {
	version: number;
	content: string;
	changeType?: BeliefChangeType;
	changeSummary?: string;
	triggeredByTurnId?: string;
};

export type PersonaSummaryForViewer = {
	id: string;
	name: string;
	role: string;
	beliefHistory: PersonaBeliefVersion[];
};

export type BeliefChangeTrigger = {
	personaId: string;
	personaName: string;
	changeType: BeliefChangeType;
	changeSummary: string;
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
