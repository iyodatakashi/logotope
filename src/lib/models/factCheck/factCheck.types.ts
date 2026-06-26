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

// インライン検証・補正の監査トレース（ターンに埋め込み）。表示 UI は本仕様の対象外（型整合のみ）。
export type TurnFactCheckTrace = {
	status: 'checked' | 'unverified';
	revised: boolean;
	findings: FactCheckFinding[];
	originalContent?: string;
};
