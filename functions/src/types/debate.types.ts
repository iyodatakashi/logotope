import type { Timestamp } from 'firebase-admin/firestore';
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
	chapterEndCount?: number;
	status: ChapterProgressStatus;
};

export type ChapterProgress = {
	chapterEndCount: number;
	discussionPointStatuses: DiscussionPointState[];
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
	createdAt: Timestamp;
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
	chapterEndCount?: number;
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

export type TurnStepKind = 'open' | 'turn' | 'summary' | 'closing' | 'comments';

export type TurnStepPayload = {
	topicId: string;
	chapterIndex: number;
	runId: string;
	stepKind: TurnStepKind;
	expectedTurnIndex: number;
	singleChapterMode?: boolean;
	// 章末の未応答指名に対する最終応答（+1）ターンであることを示す。処理後は summary/closing へ直行する
	finalResponse?: boolean;
};

export type NextStep =
	| { kind: 'turn'; expectedTurnIndex: number; finalResponse?: boolean }
	| { kind: 'summary'; expectedTurnIndex: number }
	| { kind: 'closing'; expectedTurnIndex: number }
	| { kind: 'open'; chapterIndex: number; expectedTurnIndex: 0 }
	| { kind: 'comments' }
	| { kind: 'none' };
