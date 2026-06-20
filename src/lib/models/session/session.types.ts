import { Timestamp } from 'firebase/firestore';
import type { PersonaSummaryForViewer, BeliefChangeTrigger } from '../persona/persona.types';

export type SpeakerType = 'facilitator' | 'persona';

export type ChapterDoc = {
	title: string;
	focusQuestion: string;
	discussionPoints?: string[];
	startTurnIndex?: number;
};

export type TurnDoc = {
	id: string;
	turnIndex: number;
	speakerType: SpeakerType;
	personaId?: string;
	content: string;
	createdAt: Timestamp;
	speechMode?: 'opinion' | 'fact';
	engagementScore?: number;
	fromQueue?: boolean;
	targetPersonaId?: string;
};

export type PostDebateCommentDoc = {
	id: string;
	personaId: string;
	content: string;
	sortOrder: number;
};

export type ChapterAnalysisDoc = {
	general: string[];
	persona: string[];
};

export type DiscussionPointStatus = 'untouched' | 'introduced' | 'addressed';

export type DiscussionPointStatusDoc = {
	point: string;
	status: DiscussionPointStatus;
};

export type ChapterProgressStatus = 'pending' | 'running' | 'completed';

export type ChapterStateDoc = {
	chapterIndex: number;
	title: string;
	focusQuestion: string;
	discussionPoints: string[];
	turns: TurnDoc[];
	discussionPointStatuses?: DiscussionPointStatusDoc[];
	status: ChapterProgressStatus;
};

export type PostDebateCommentsDoc = {
	comments: PostDebateCommentDoc[];
};

export type PublishedTurn = {
	id: string;
	turnIndex: number;
	speakerType: SpeakerType;
	personaId?: string | null;
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
