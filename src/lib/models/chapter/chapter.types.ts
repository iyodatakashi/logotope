import type { Turn, TurnForFirestore } from '$lib/models/turn/turn.types';

export type ChapterProgressStatus = 'pending' | 'running' | 'completed';

export type AgendaItemStatus = 'untouched' | 'introduced' | 'addressed';

export type AgendaItemState = {
	point: string;
	status: AgendaItemStatus;
};

export type ChapterForFirestore = {
	chapterIndex: number;
	title: string;
	agenda: string[];
	turns: TurnForFirestore[];
	agendaItemStatuses?: AgendaItemState[];
	status: ChapterProgressStatus;
};

export type Chapter = Omit<ChapterForFirestore, 'turns'> & {
	id: string;
	turns: Turn[];
};

export type IssueSource = 'general' | 'persona';

export type Issue = {
	id: string;
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
