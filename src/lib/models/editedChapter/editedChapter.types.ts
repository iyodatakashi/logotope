import type { EditedTurn, EditedTurnForFirestore } from '$lib/models/editedTurn/editedTurn.types';
import type { InlineDiffSegment } from '$lib/utils/inlineDiff';

export type EditingChapterStatus = 'pending' | 'completed' | 'failed';

export type EditedChapterForFirestore = {
	chapterIndex: number;
	title: string;
	agenda: string[];
	turns: EditedTurnForFirestore[];
	status: EditingChapterStatus;
	failureReason?: string; // status='failed' のときの構造検証不合格理由（管理画面での把握・診断用）
};

export type EditedChapter = Omit<EditedChapterForFirestore, 'turns'> & {
	id: string;
	turns: EditedTurn[];
};

// 表示用の章別編集状態。成果物が存在しない章（未実行・実行中）は 'missing' として原本にフォールバックする。
export type EditedChapterDisplayStatus = EditingChapterStatus | 'missing';

// 編集画面の差分レビュー1行（view-model）。原本↔編集後の差分・削除された原本・話者ラベル・気づきを
// 描画用に1本へ畳んだ形。永続・ドメインには無い表示専用情報を持つため EditedTurn とは別型にする。
export type TurnForEditing = {
	id: string;
	name: string; // 話者名（personaId から解決済み）
	role: string; // 役割（同上）
	content: string;
	speechMode?: string;
	diff: InlineDiffSegment[] | null; // 原本↔編集後の差分。削除された原本（removed）や未編集は null
	removed: boolean; // 編集後に使われず削除された原本ターンか
	awarenesses: { personaName: string; content: string }[];
};
