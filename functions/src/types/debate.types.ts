import type { DebateTurn } from './turn.types.js';
import type { DiscussionPointState } from './chapter.types.js';
import type { AwarenessKind } from './persona.types.js';

// 傾聴段階で検出する気づき（永続前の値）。永続形は AwarenessForFirestore
export type AwarenessEvent = {
	kind: AwarenessKind;
	content: string;
	sourcePersonaId: string | null; // reception のとき由来ペルソナ、self は null
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
	targetPersonaId?: string;
	searchUsed?: boolean;
	searchQueries?: string[];
};

export type Engagement = {
	personaId: string;
	score: number;
	mode: 'opinion' | 'fact' | 'none' | 'question';
	intentSummary?: string;
	awareness?: AwarenessEvent | null; // 傾聴段階で検出（大半は null）
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

export type ImpressionResult = {
	personaId: string;
	content: string;
};
