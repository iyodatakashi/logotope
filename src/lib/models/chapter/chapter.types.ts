import type { Turn, TurnForFirestore } from '$lib/models/turn/turn.types';

export type ChapterProgressStatus = 'pending' | 'running' | 'completed';

export type DiscussionPointStatus = 'untouched' | 'introduced' | 'addressed';

export type DiscussionPointState = {
	point: string;
	status: DiscussionPointStatus;
};

export type ChapterForFirestore = {
	chapterIndex: number;
	title: string;
	discussionPoints: string[];
	turns: TurnForFirestore[];
	discussionPointStatuses?: DiscussionPointState[];
	status: ChapterProgressStatus;
};

export type Chapter = Omit<ChapterForFirestore, 'turns'> & {
	id: string;
	turns: Turn[];
};

export type IssueSource = 'general' | 'persona';

export type Issue = {
	text: string;
	source: IssueSource;
	score?: number;
	reason?: string;
	selected?: boolean;
};

export type IssueGroup = {
	issueIndexes: number[];
};

export type ChapterAnalysisForFirestore = {
	issues: Issue[];
	issueGroups?: IssueGroup[];
};
