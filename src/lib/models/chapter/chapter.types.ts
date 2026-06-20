import type { Turn, TurnDoc } from '$lib/models/turn/turn.types';

export type ChapterProgressStatus = 'pending' | 'running' | 'completed';

export type DiscussionPointStatus = 'untouched' | 'introduced' | 'addressed';

export type DiscussionPointStatusDoc = {
	point: string;
	status: DiscussionPointStatus;
};

export type ChapterDoc = {
	chapterIndex: number;
	title: string;
	focusQuestion: string;
	discussionPoints: string[];
	turns: TurnDoc[];
	discussionPointStatuses?: DiscussionPointStatusDoc[];
	status: ChapterProgressStatus;
};

export type Chapter = Omit<ChapterDoc, 'turns'> & {
	id: string;
	turns: Turn[];
};

export type ChapterAnalysisDoc = {
	general: string[];
	persona: string[];
};
