import type { Timestamp } from 'firebase-admin/firestore';
import type { Chapter, DiscussionPointState } from './chapter.types.js';

export type DebateTurn = {
	id: string;
	speakerType: string;
	personaId?: string | null;
	content: string;
	createdAt: Timestamp;
	speechMode?: 'opinion' | 'fact' | 'question';
	engagementScore?: number;
	fromQueue?: boolean;
	targetPersonaId?: string;
	targetedBy?: 'facilitator' | 'persona';
	searchUsed?: boolean;
	searchQueries?: string[];
};

export type NewTurnFields = {
	speakerType: 'persona' | 'facilitator';
	personaId?: string;
	content: string;
	speechMode?: 'opinion' | 'fact' | 'question';
	engagementScore?: number;
	fromQueue?: boolean;
	targetPersonaId?: string;
	targetedBy?: 'facilitator' | 'persona';
	searchUsed?: boolean;
	searchQueries?: string[];
};

export type ProgressPatch = {
	quietStreak?: number;
	discussionPointStatuses?: DiscussionPointState[];
};

export type AppendTurnInput = {
	topicId: string;
	chapterId: string;
	expectedTurnIndex: number;
	turn: NewTurnFields;
	runId?: string;
	progressPatch?: ProgressPatch;
};

export type AppendResult =
	| { status: 'committed'; id: string }
	| { status: 'rejected'; reason: 'index_mismatch' | 'generation_mismatch' | 'debate_inactive' };

export type TurnGenerationContext = {
	chapterTurns: ReadonlyArray<DebateTurn>;
	chapter: Chapter;
	queuedTrigger?: { speakerName: string; content: string };
	targetedBy?: 'facilitator' | 'persona';
	otherPersonas?: ReadonlyArray<{ id: string; name: string }>;
};
