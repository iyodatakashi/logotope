import type { DebateTurn } from './turn.types.js';

export type Chapter = {
	id: string;
	title: string;
	agenda: string[];
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

export type AgendaItemStatus = 'untouched' | 'introduced' | 'addressed';

export type AgendaItemState = {
	point: string;
	status: AgendaItemStatus;
	introducedOrder?: number;
};

export type ChapterProgressStatus = 'pending' | 'running' | 'completed';

export type ChapterForFirestore = {
	chapterIndex: number;
	title: string;
	agenda: string[];
	turns: DebateTurn[];
	agendaItemStatuses?: AgendaItemState[];
	quietStreak?: number;
	status: ChapterProgressStatus;
};

export type ChapterProgress = {
	quietStreak: number;
	agendaItemStatuses: AgendaItemState[];
};

/**
 * 章ドキュメントを永続データから読み出したランタイム形。
 * 永続スキーマ ChapterForFirestore とは別物として併存させる（本スペックでは統一しない）。
 */
export type ChapterEntry = {
	id: string;
	chapterIndex: number;
	title: string;
	agenda: string[];
	turns: DebateTurn[];
	status: 'pending' | 'running' | 'completed';
};
