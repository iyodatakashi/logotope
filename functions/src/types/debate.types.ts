import type { DebateTurn } from './turn.types.js';
import type { DiscussionPointState } from './chapter.types.js';

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

export type DebateState = {
	turns: DebateTurn[];
	silenceMap: Map<string, number>;
	speakCount: Map<string, number>;
	lastSpeakerId?: string;
	queuedIntents: Map<string, QueuedIntent[]>;
	discussionPoints: DiscussionPointState[];
	runId?: string;
};

export type FacilitatorReply = {
	content?: string;
	targetPersonaId?: string;
	selectedDiscussionPointIndex?: number;
	relevantPersonaIds?: string[]; // 論点投入時に判定する「立場を聞くべき関連参加者」（opening / 介入）
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

export type PostDebateCommentResult = {
	personaId: string;
	content: string;
};
