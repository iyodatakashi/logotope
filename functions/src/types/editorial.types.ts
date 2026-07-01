// 編集成果物の永続型。生ディベート（章・ターン・事後コメント）とは別コレクションに保存する。
// 型は Firestore 永続形と一致させる（変換関数は持たない）。

// 由来ターンID群は 1 件以上を必須とし、連結時は複数を許容する不変条件を型で表現する。
export type NonEmptyArray<T> = [T, ...T[]];

export const isNonEmptyArray = <T>(value: readonly T[]): value is NonEmptyArray<T> =>
	value.length >= 1;

// 編集後ターン: 散文・発話者・由来。注釈（信念変化/ファクトチェック）は持たず原本を参照する。
export type EditedTurnForFirestore = {
	id: string; // nanoid（編集ターンの新規 id）
	sourceTurnIds: NonEmptyArray<string>; // 由来する原本ターン id（>=1、連結時は複数）
	speakerType: 'persona' | 'facilitator';
	personaId?: string | null;
	content: string; // 編集後の散文
	speechMode?: 'opinion' | 'fact' | 'question';
};

export type EditingChapterStatus = 'pending' | 'completed' | 'failed';

export type EditedChapterForFirestore = {
	chapterIndex: number;
	title: string; // 原本からコピー（編集対象外）
	discussionPoints: string[]; // 原本からコピー
	turns: EditedTurnForFirestore[];
	status: EditingChapterStatus;
	failureReason?: string; // status='failed' のときの構造検証不合格理由（管理画面での把握・診断用）
};

export type EditedPostDebateCommentForFirestore = {
	id: string;
	sourceCommentId: string;
	personaId: string;
	content: string;
	sortOrder: number;
};

export type EditedPostDebateCommentsForFirestore = {
	comments: EditedPostDebateCommentForFirestore[];
};
