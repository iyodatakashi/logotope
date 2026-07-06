import { Timestamp } from 'firebase/firestore';

export type SpeakerType = 'facilitator' | 'persona';

export type FactCheckVerdict = 'incorrect' | 'unverifiable';

export type FactCheckSource = { title: string; url: string };

// インライン検証で検出した事実誤り指摘。ターンに埋め込まれる Firestore 永続形のミラー。
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

// インライン検証・補正の監査トレース（ターンに埋め込み）。表示 UI は本仕様の対象外（型整合のみ）。
export type TurnFactCheckTrace = {
	status: 'checked' | 'unverified';
	revised: boolean;
	findings: FactCheckFinding[];
	originalContent?: string;
};

export type TurnForFirestore = {
	id: string;
	speakerType: SpeakerType;
	personaId?: string;
	content: string;
	createdAt: Timestamp;
	speechMode?: 'opinion' | 'fact';
	engagementScore?: number;
	fromQueue?: boolean;
	targetPersonaId?: string;
	factCheck?: TurnFactCheckTrace;
};

export type Turn = Omit<TurnForFirestore, 'createdAt'> & { createdAt: Date };
