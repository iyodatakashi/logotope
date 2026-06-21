import type { Chapter } from './chapter.types.js';

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
};

export type DiscussionPointStatus = 'untouched' | 'introduced' | 'addressed';

export type DiscussionPointState = {
	point: string;
	status: DiscussionPointStatus;
};

export type ChapterProgressStatus = 'pending' | 'running' | 'completed';

export type ChapterForFirestore = {
	chapterIndex: number;
	title: string;
	focusQuestion: string;
	discussionPoints: string[];
	turns: DebateTurn[];
	discussionPointStatuses?: DiscussionPointState[];
	status: ChapterProgressStatus;
};

export type DebateState = {
	turns: DebateTurn[];
	silenceMap: Map<string, number>;
	speakCount: Map<string, number>;
	lastSpeakerId?: string;
	queuedIntents: Map<string, QueuedIntent[]>;
	pairConversationTurns: number;
	discussionPoints: DiscussionPointState[];
};

export type FacilitatorReply = {
	content?: string;
	targetPersonaId?: string;
	selectedDiscussionPointIndex?: number;
};

export type PersonaReply = {
	content: string;
	speechMode?: 'opinion' | 'fact' | 'question';
	beliefChange: BeliefChangeEvent | null;
	targetPersonaId?: string;
	searchUsed?: boolean;
	searchQueries?: string[];
};

export type Engagement = {
	personaId: string;
	score: number;
	mode: 'opinion' | 'fact' | 'none' | 'question';
	intentSummary?: string;
};

export type SpeakerSelection = {
	personaId: string;
	reason: 'targeted_by_facilitator' | 'targeted_by_persona' | 'queue' | 'score';
	intentSummary?: string;
};

export type QueuedIntent = {
	triggerTurnId: string;
	intentSummary: string;
};

export type TurnGenerationContext = {
	chapterTurns: ReadonlyArray<DebateTurn>;
	chapter: Chapter;
	queuedTrigger?: { speakerName: string; content: string };
	targetedBy?: 'facilitator' | 'persona';
	otherPersonas?: ReadonlyArray<{ id: string; name: string }>;
};

export type DebateTurn = {
	id: string;
	speakerType: string;
	personaId?: string | null;
	content: string;
	createdAt: string;
	speechMode?: 'opinion' | 'fact' | 'question';
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
