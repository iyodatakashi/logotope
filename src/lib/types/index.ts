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

export interface PublishedDebateDetail {
  id: string;
  topicTitle: string;
  personas: PersonaSummaryForViewer[];
  turns: PublishedTurn[];
  postDebateComments: PublishedComment[];
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

export interface ProgressState {
  status: DebateStatus;
  currentStep: string | null;
  completed: number;
  total: number;
  updatedAt: string;
}
