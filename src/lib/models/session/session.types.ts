import { Timestamp } from 'firebase/firestore';
import type { DebateStatus } from '../topic/topic.types.js';
import type { PersonaSummaryForViewer, BeliefChangeTrigger } from '../persona/persona.types.js';

export type SpeakerType = 'facilitator' | 'persona';

export type ChapterDoc = {
	index: number;
	title: string;
	focusQuestion: string;
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
	chapterIndex?: number;
	speechMode?: 'reaction' | 'full';
	fromQueue?: boolean;
};

export type PostDebateCommentDoc = {
	id: string;
	personaId: string;
	content: string;
	sortOrder: number;
};

export type SessionDoc = {
	status: DebateStatus;
	totalTurns?: number;
	createdAt: Timestamp;
	completedAt?: Timestamp;
	publishedAt?: Timestamp;
	turns: TurnDoc[];
	postDebateComments: PostDebateCommentDoc[];
	chapters?: ChapterDoc[];
	currentChapterIndex?: number;
};

export type PublishedTurn = {
	id: string;
	turnIndex: number;
	speakerType: SpeakerType;
	speakerName: string;
	speakerRole: string;
	content: string;
	beliefChangesTriggered: BeliefChangeTrigger[];
	chapterIndex?: number;
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
