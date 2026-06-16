import type { Persona } from './persona.types.js';
import type { Chapter } from './chapter.types.js';
export type { Chapter };

export type BeliefChangeType = 'opinion_change' | 'partial_acceptance';
export type SpeakerSource = 'nomination' | 'direct_address' | 'queue' | 'score';

export type BeliefChangeEvent = {
	type: BeliefChangeType;
	summary: string;
	updatedBelief: string;
};

export type DebateSession = {
	id: string;
	topicId: string;
	totalTurns?: number | null;
	createdAt: string;
	completedAt?: string | null;
	publishedAt?: string | null;
	chapters?: Chapter[];
	currentChapterIndex?: number;
};

export type FacilitatorReply = {
	content?: string;
	targetPersonaId?: string;
};

export type PersonaReply = {
	content: string;
	speechMode?: 'opinion' | 'fact';
	beliefChange: BeliefChangeEvent | null;
	targetPersonaId?: string;
	searchUsed?: boolean;
	searchQueries?: string[];
};

export type Engagement = {
	personaId: string;
	score: number;
	mode: 'opinion' | 'fact' | 'none';
	intentSummary?: string;
};

export type SpeakerDecision = {
	personaId: string;
	source: SpeakerSource;
	intentSummary?: string;
};

export type PendingIntent = {
	triggerTurnIndex: number;
	intentSummary: string;
};

export type DirectAddressInput = {
	pendingAddress?: { personaId: string; byFacilitator: boolean };
	consecutiveDirectExchanges: number;
	personaIds: ReadonlyArray<string>;
};

export type SpeakerSelectionInput = {
	assessments: ReadonlyArray<Engagement>;
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
	personas: ReadonlyArray<Persona>;
	persistedPendingIntents: ReadonlyMap<string, ReadonlyArray<PendingIntent>>;
	currentBeliefs: Map<string, { content: string; version: number }>;
};

export type TurnGenerationContext = {
	chapterHistory: ReadonlyArray<DebateTurn>;
	chapter: Chapter;
	mode?: 'opinion' | 'fact';
	score?: number;
	intentSummary?: string;
	pendingTrigger?: { speakerName: string; content: string };
	nominatedByFacilitator: boolean;
};

export type OrchestratorOptions = {
	turnsPerChapter: number;
	maxTurns: number;
	interventionCooldown: number;
	singleChapterMode?: boolean;
};

export type DebateTurn = {
	id: string;
	sessionId: string;
	turnIndex: number;
	speakerType: string;
	personaId?: string | null;
	speakerName?: string;
	speakerRole?: string;
	content: string;
	createdAt: string;
	chapterId?: string;
	speechMode?: 'opinion' | 'fact';
	engagementScore?: number;
	fromQueue?: boolean;
	targetPersonaId?: string;
	searchUsed?: boolean;
	searchQueries?: string[];
};

export type PostDebateCommentResult = {
	personaId: string;
	content: string;
};
