import { Timestamp } from 'firebase/firestore';
import type { PersonaSummaryForViewer, BeliefChangeTrigger } from '../persona/persona.types.js';

export type SpeakerType = 'facilitator' | 'persona';

export type ChapterDoc = {
	title: string;
	focusQuestion: string;
	startTurnIndex?: number;
};

export type TurnDoc = {
	id: string;
	turnIndex: number;
	speakerType: SpeakerType;
	personaId?: string;
	speakerName?: string;
	speakerRole?: string;
	content: string;
	createdAt: Timestamp;
	speechMode?: 'opinion' | 'fact';
	engagementScore?: number;
	fromQueue?: boolean;
	addressedPersonaId?: string;
};

export type PostDebateCommentDoc = {
	id: string;
	personaId: string;
	content: string;
	sortOrder: number;
};

export type ChapterIssuesDoc = {
	general: string[];
	persona: string[];
};

export type SessionDoc = {
	totalTurns?: number;
	createdAt: Timestamp;
	completedAt?: Timestamp;
	publishedAt?: Timestamp;
	turns: TurnDoc[];
	postDebateComments: PostDebateCommentDoc[];
	chapters?: ChapterDoc[];
	currentChapterIndex?: number;
	chapterIssues?: ChapterIssuesDoc;
};

export type PublishedTurn = {
	id: string;
	turnIndex: number;
	speakerType: SpeakerType;
	speakerName: string;
	speakerRole: string;
	content: string;
	beliefChangesTriggered: BeliefChangeTrigger[];
};

export type PublishedComment = {
	personaId: string;
	personaName: string;
	personaRole: string;
	content: string;
};

export type PublishedDebateDetail = {
	id: string;
	topicTitle: string;
	personas: PersonaSummaryForViewer[];
	turns: PublishedTurn[];
	postDebateComments: PublishedComment[];
	chapters?: ChapterDoc[];
};
