// 統合保存 editorial/0（導入・締め・所感）の永続形。functions 側 editorial.types.ts と一致させる。
// 導入・締めは各1、所感は personaId をキーにしたマップ。原本 draft と編集後 final を各要素が持つ。

// intro/outro の記事要素。永続形とオンメモリ形が完全に同一（id も日付差も無い）なため単一の型にする。
export type Narration = {
	draft: string | null;
	final: string | null;
};

export type ImpressionForFirestore = {
	sortOrder: number;
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

// 記事の読み取りモデル（非永続）。編集後があれば final、無く原本があれば draft_only、どちらも無ければ missing。
export type ElementStatus = 'final' | 'draft_only' | 'missing';
