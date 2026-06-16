import type { PendingIntent } from './debate.types.js';
import type { DebateTurn, PersonaProfile } from './repository.types.js';

export type DirectAddressInput = {
	pendingAddress?: { personaId: string; byFacilitator: boolean };
	consecutiveDirectExchanges: number;
	personaIds: ReadonlyArray<string>;
};

export type SpeakerAssessment = {
	personaId: string;
	score: number;
	mode: 'opinion' | 'fact' | 'none';
	intentSummary?: string;
};

export type SpeakerSelectionInput = {
	assessments: ReadonlyArray<SpeakerAssessment>;
	pendingIntents: ReadonlyMap<string, ReadonlyArray<PendingIntent>>;
	silenceMap: ReadonlyMap<string, number>;
	lastSpeakerId?: string;
	personaIds: ReadonlyArray<string>;
};

export type ChapterEndInput = {
	chapterTurnCount: number;
	targetTurns: number;
	engagementSignals: ReadonlyArray<0 | 1>;
};

export type InterventionPolicyInput = {
	personaTurnsSinceFacilitator: number;
	cooldownTurns: number;
};

export type DebateState = {
	history: DebateTurn[];
	currentBeliefs: Map<string, { content: string; version: number }>;
	silenceMap: Map<string, number>;
	speakCount: Map<string, number>;
	pendingAddress?: { personaId: string; byFacilitator: boolean };
	lastSpeakerId?: string;
	pendingIntents: Map<string, PendingIntent[]>;
	consecutiveDirectExchanges: number;
	engagementSignals: Array<0 | 1>;
	currentTurnIndex: number;
	lastFacilitatorTurnIndex: number;
};

export type RestoreInput = {
	turns: ReadonlyArray<DebateTurn>;
	personas: ReadonlyArray<PersonaProfile>;
	persistedPendingIntents: ReadonlyMap<string, ReadonlyArray<PendingIntent>>;
	currentBeliefs: Map<string, { content: string; version: number }>;
};
