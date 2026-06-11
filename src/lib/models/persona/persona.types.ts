import { Timestamp } from 'firebase/firestore';

export type BeliefChangeType = 'opinion_change' | 'partial_acceptance';

export type BeliefDoc = {
	id: string;
	version: number;
	content: string;
	changeType?: BeliefChangeType;
	changeSummary?: string;
	triggeredByTurnId?: string;
	createdAt: Timestamp;
};

export type InterviewDoc = {
	interviewRecord?: string;
	status: 'queued' | 'in_progress' | 'completed' | 'error';
	errorMessage?: string;
	completedAt?: Timestamp;
};

export type PersonaDoc = {
	id: string;
	topicId: string;
	stakeholderRole: string;
	name: string;
	age: number;
	occupation: string;
	background: string;
	interests: string;
	stanceDirection: string;
	approved: boolean;
	sortOrder: number;
	interview?: InterviewDoc;
	beliefs: BeliefDoc[];
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
	name: string;
	nationality?: string;
	age: number;
	occupation: string;
	background: string;
	interests: string;
	stanceDirection: string;
	llmType?: string;
};

export type PersonaForInterview = {
	name: string;
	age: number;
	occupation: string;
	stakeholderRole: string;
	background: string;
	interests: string;
};
