import type { Chapter } from './chapter.types.js';
export type { Chapter };

export type BeliefChangeType = 'opinion_change' | 'partial_acceptance';
export type BeliefChangeEvent = {
	type: BeliefChangeType;
	summary: string;
	updatedBelief: string;
};

export type DebateOptions = {
	turnsPerChapter: number;
	maxTurns: number;
	interventionCooldown: number;
	singleChapterMode?: boolean;
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

export type DebateState = {
	turns: DebateTurn[];
	silenceMap: Map<string, number>;
	speakCount: Map<string, number>;
	lastSpeakerId?: string;
	queuedIntents: Map<string, QueuedIntent[]>;
	pairConversationTurns: number;
	currentTurnIndex: number;
	lastFacilitatorTurnIndex: number;
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

export type SpeakerSelection = {
	personaId: string;
	reason: 'targeted_by_facilitator' | 'targeted_by_persona' | 'queue' | 'score';
	intentSummary?: string;
};

export type QueuedIntent = {
	triggerTurnIndex: number;
	intentSummary: string;
};

export type TurnGenerationContext = {
	chapterTurns: ReadonlyArray<DebateTurn>;
	chapter: Chapter;
	pendingTrigger?: { speakerName: string; content: string };
	targetedBy?: 'facilitator' | 'persona';
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
	targetedBy?: 'facilitator' | 'persona';
	searchUsed?: boolean;
	searchQueries?: string[];
};

export type PostDebateCommentResult = {
	personaId: string;
	content: string;
};
