import type { Turn, TurnForFirestore, EditedTurn } from '$lib/models/turn/turn.types';

export type ChapterProgressStatus = 'pending' | 'running' | 'completed';

export type AgendaItemStatus = 'untouched' | 'introduced' | 'addressed';

export type AgendaItemState = {
	point: string;
	status: AgendaItemStatus;
};

// 生成中（未コミット）の persona ターンの段階。turns[] 外に持ち frontier から隔離する。永続形のミラー。
export type PendingTurnStatus = 'generating' | 'fact-checking';

// 生成中の persona ターン。コミットで同 id を turns[] へ移送する。
export type PendingTurn = {
	id: string;
	personaId: string;
	expectedTurnIndex: number;
	status: PendingTurnStatus;
};

export type ChapterForFirestore = {
	chapterIndex: number;
	title: string;
	agenda: string[];
	turns: TurnForFirestore[];
	agendaItemStatuses?: AgendaItemState[];
	status: ChapterProgressStatus;
	pendingTurn?: PendingTurn;
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

// --- 編集後章（編集フェーズの成果物）---

export type EditingChapterStatus = 'pending' | 'completed' | 'failed';

export type EditedChapterForFirestore = {
	chapterIndex: number;
	title: string;
	agenda: string[];
	turns: EditedTurn[];
	status: EditingChapterStatus;
	failureReason?: string; // status='failed' のときの構造検証不合格理由（管理画面での把握・診断用）
};

// 実行時形は永続形に doc id を足すだけ（turns も永続形＝EditedTurn[] で同一）。
export type EditedChapter = EditedChapterForFirestore & { id: string };

// 表示用の章別編集状態。成果物が存在しない章（未実行・実行中）は 'missing' として原本にフォールバックする。
export type EditedChapterDisplayStatus = EditingChapterStatus | 'missing';
