import type { EditedTurn } from '$lib/models/turn/turn.types';

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
