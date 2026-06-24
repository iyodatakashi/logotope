import type { DebateTurn } from './turn.types.js';

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
	quietStreak?: number;
	status: ChapterProgressStatus;
};

export type ChapterProgress = {
	quietStreak: number;
	discussionPointStatuses: DiscussionPointState[];
};

/**
 * 章ドキュメントを永続データから読み出したランタイム形。
 * 永続スキーマ ChapterForFirestore とは別物として併存させる（本スペックでは統一しない）。
 */
export type ChapterEntry = {
	id: string;
	chapterIndex: number;
	title: string;
	focusQuestion: string;
	discussionPoints: string[];
	turns: DebateTurn[];
	status: 'pending' | 'running' | 'completed';
};
