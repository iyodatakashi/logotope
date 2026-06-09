export type DebateStatus =
  | 'pending'
  | 'surveying'
  | 'generating_personas'
  | 'interviewing'
  | 'debating'
  | 'completed'
  | 'published';

export type BeliefChangeType = 'opinion_change' | 'partial_acceptance';
export type SpeakerType = 'facilitator' | 'persona';

export interface TopicSummary {
  id: string;
  title: string;
  status: DebateStatus;
  createdAt: string;
}

export interface PublishedDebateSummary {
  id: string;
  topicTitle: string;
  personaCount: number;
  publishedAt: string;
}

export interface ChapterDoc {
  index: number;
  title: string;
  focusQuestion: string;
}

export interface PublishedDebateDetail {
  id: string;
  topicTitle: string;
  personas: PersonaSummaryForViewer[];
  turns: PublishedTurn[];
  postDebateComments: PublishedComment[];
  chapters?: ChapterDoc[];
}

export interface PersonaSummaryForViewer {
  id: string;
  name: string;
  role: string;
  beliefHistory: PersonaBeliefVersion[];
}

export interface PersonaBeliefVersion {
  version: number;
  content: string;
  changeType?: BeliefChangeType;
  changeSummary?: string;
  triggeredByTurnId?: string;
}

export interface PublishedTurn {
  id: string;
  turnIndex: number;
  speakerType: SpeakerType;
  speakerName: string;
  speakerRole: string;
  content: string;
  beliefChangesTriggered: BeliefChangeTrigger[];
  chapterIndex?: number;
}

export interface BeliefChangeTrigger {
  personaId: string;
  personaName: string;
  changeType: BeliefChangeType;
  changeSummary: string;
}

export interface PublishedComment {
  personaId: string;
  personaName: string;
  personaRole: string;
  content: string;
}

// --- Firestore Document Types ---

import type { Timestamp } from 'firebase/firestore';

export interface StakeholderDoc {
  role: string;
  reason: string;
  mainInterests: string[];
  stanceDirection: string;
  minorityLevel: string;
}

export interface TopicDoc {
  id: string;
  title: string;
  status: DebateStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  publishedAt?: Timestamp;
  personaCount?: number;
  stakeholders?: {
    items: StakeholderDoc[];
    approved: boolean;
    createdAt: Timestamp;
  };
}

export interface InterviewDoc {
  interviewRecord?: string;
  status: 'queued' | 'in_progress' | 'completed' | 'error';
  errorMessage?: string;
  completedAt?: Timestamp;
}

export interface BeliefDoc {
  id: string;
  version: number;
  content: string;
  changeType?: BeliefChangeType;
  changeSummary?: string;
  triggeredByTurnId?: string;
  createdAt: Timestamp;
}

export interface PersonaDoc {
  id: string;
  topicId: string;
  stakeholderRole: string;
  name: string;
  age: number;
  occupation: string;
  background: string;
  interests: string;
  stanceDirection: string;
  approved: boolean;
  sortOrder: number;
  interview?: InterviewDoc;
  beliefs: BeliefDoc[];
}

export interface TurnDoc {
  id: string;
  turnIndex: number;
  speakerType: SpeakerType;
  personaId?: string;
  content: string;
  createdAt: Timestamp;
  chapterIndex?: number;
}

export interface PostDebateCommentDoc {
  id: string;
  personaId: string;
  content: string;
  sortOrder: number;
}

export interface SessionDoc {
  status: DebateStatus;
  totalTurns?: number;
  createdAt: Timestamp;
  completedAt?: Timestamp;
  publishedAt?: Timestamp;
  turns: TurnDoc[];
  postDebateComments: PostDebateCommentDoc[];
  chapters?: ChapterDoc[];
  currentChapterIndex?: number;
}
