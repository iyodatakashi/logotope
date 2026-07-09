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
	agenda: string[]; // 原本からコピー
	turns: EditedTurnForFirestore[];
	status: EditingChapterStatus;
	failureReason?: string; // status='failed' のときの構造検証不合格理由（管理画面での把握・診断用）
};

// 記事要素の進捗ステータス。生成待ち／原本生成中／整え中／処理完了を表す。
// 「生成待ち」と「失敗」は内容がともに空で区別できないため、この軸を永続化する
// （成否＝編集済み／編集失敗／生成失敗は draft/final の有無から算出し、ステータスには持たない）。
export type EditorialElementStatus = 'pending' | 'generating' | 'editing' | 'finished';

// 導入・締めの記事要素。進捗ステータスと、原本 draft・編集後 final を持つ（未生成/失敗は null）。
export type Narration = {
	status: EditorialElementStatus;
	draft: string | null;
	final: string | null;
};

// 所感の記事要素（承認ペルソナごと）。sortOrder で表示順を保ち、進捗ステータスと原本 draft・編集後 final を持つ。
export type ImpressionForFirestore = {
	sortOrder: number;
	status: EditorialElementStatus;
	draft: string | null;
	final: string | null;
};

// 導入・締め・所感をまとめた統合ドキュメント editorial/0。所感は personaId をキーにしたマップにし、
// 記事要素ごとの部分上書き（blind write・衝突なし）を可能にする。本体(章)は別保存（editedChapters）。
export type EditorialForFirestore = {
	intro: Narration;
	outro: Narration;
	impressions: Record<string, ImpressionForFirestore>;
};

// 個別再生成の対象となる記事要素。共通入口 onCall（regenerateArticleElement）の request と種別振り分けに使う。
export type ArticleElement =
	| { kind: 'chapter'; chapterId: string }
	| { kind: 'intro' }
	| { kind: 'outro' }
	| { kind: 'impression'; personaId: string };
