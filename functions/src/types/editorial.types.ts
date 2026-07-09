// 編集出力（導入・締め・所感）の永続型。編集後ターン/章は turn.types / chapter.types に集約する。
// 型は Firestore 永続形と一致させる（変換関数は持たない）。

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
