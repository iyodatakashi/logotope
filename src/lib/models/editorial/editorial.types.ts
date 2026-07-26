// 統合保存 editorial/0（導入・締め・所感）の永続形。functions 側 editorial.types.ts と一致させる。
// 導入・締めは各1、所感は personaId をキーにしたマップ。原本 draft と編集後 final を各要素が持つ。

// editorial（導入・締め・所感）の進捗ステータス。functions 側 editorial.types.ts と一致させる。
// 生成待ち／原本生成中／整え中／処理完了を表し、「生成待ち」と「失敗」（ともに内容が空）を区別する。
// 成否（編集済み／編集失敗／生成失敗）は draft/final の有無から算出し、ステータスには持たない。
export type EditorialStatus = 'pending' | 'generating' | 'editing' | 'finished';

// intro/outro の editorial。永続形とオンメモリ形が完全に同一（id も日付差も無い）なため単一の型にする。
export type Narration = {
	status: EditorialStatus;
	draft: string | null;
	final: string | null;
};

export type ImpressionForFirestore = {
	sortOrder: number;
	status: EditorialStatus;
	draft: string | null;
	final: string | null;
};

// オンメモリのドメイン形。永続形がマップのキーに持っていた personaId を id 相当として materialize する
// （Chapter が doc id を id として持つのと同じ関係）。name/role/差分は描画側で組む派生でここには持たない。
export type Impression = ImpressionForFirestore & { personaId: string };

export type EditorialForFirestore = {
	intro: Narration;
	outro: Narration;
	impressions: Record<string, ImpressionForFirestore>;
};

// 個別再生成の対象となる記事要素。共通入口 onCall（regenerateArticleElement）の request に渡す。
export type ArticleElement =
	| { kind: 'chapter'; chapterId: string }
	| { kind: 'intro' }
	| { kind: 'outro' }
	| { kind: 'impression'; personaId: string };
