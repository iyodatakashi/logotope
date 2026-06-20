import { Timestamp } from 'firebase/firestore';

export type SpeakerType = 'facilitator' | 'persona';

export type TurnDoc = {
	id: string;
	speakerType: SpeakerType;
	personaId?: string;
	content: string;
	createdAt: Timestamp;
	speechMode?: 'opinion' | 'fact';
	engagementScore?: number;
	fromQueue?: boolean;
	targetPersonaId?: string;
};

export type Turn = Omit<TurnDoc, 'createdAt'> & { createdAt: Date };
