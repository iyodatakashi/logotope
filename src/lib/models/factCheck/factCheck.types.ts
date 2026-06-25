import type { Timestamp } from 'firebase/firestore';

export type FactCheckStatus = 'running' | 'completed' | 'failed';

export type FactCheckVerdict = 'incorrect' | 'unverifiable';

export type FactCheckSource = { title: string; url: string };

export type FactCheckFinding = {
	id: string;
	turnId: string;
	speakerType: 'persona' | 'facilitator';
	claim: string;
	verdict: FactCheckVerdict;
	correction: string;
	reason: string;
	sources: FactCheckSource[];
};

export type FactCheckResultForFirestore = {
	chapterId: string;
	status: FactCheckStatus;
	findings: FactCheckFinding[];
	sources: FactCheckSource[];
	errorMessage?: string;
	startedAt: Timestamp;
	completedAt?: Timestamp;
};

export type FactCheckResult = Omit<FactCheckResultForFirestore, 'startedAt' | 'completedAt'> & {
	startedAt: Date;
	completedAt?: Date;
};
