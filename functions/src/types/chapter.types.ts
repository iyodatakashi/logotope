export type Chapter = {
	id: string;
	title: string;
	focusQuestion: string;
	discussionPoints: string[];
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
