import { Timestamp } from 'firebase/firestore';
import type { TurnFactCheckTrace } from '$lib/models/factCheck/factCheck.types';

export type SpeakerType = 'facilitator' | 'persona';

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
