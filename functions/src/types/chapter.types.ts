import type { DebateTurn, EditedTurnForFirestore } from './turn.types.js';

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

// --- 編集後章（編集フェーズの成果物・editorial から集約）。FE chapter.types の EditedChapter* と同粒度で並行 ---

export type EditingChapterStatus = 'pending' | 'completed' | 'failed';

export type EditedChapterForFirestore = {
	chapterIndex: number;
	title: string; // 原本からコピー（編集対象外）
	agenda: string[]; // 原本からコピー
	turns: EditedTurnForFirestore[];
	status: EditingChapterStatus;
	failureReason?: string; // status='failed' のときの構造検証不合格理由（管理画面での把握・診断用）
};
