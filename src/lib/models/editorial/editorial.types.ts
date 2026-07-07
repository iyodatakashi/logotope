// 統合保存 editorial/0（導入・締め・所感）の永続形。functions 側 editorial.types.ts と一致させる。
// 導入・締めは各1、所感は personaId をキーにしたマップ。原本 draft と編集後 final を各要素が持つ。

export type NarrationPartForFirestore = {
	draft: string | null;
	final: string | null;
};

export type ImpressionPartForFirestore = {
	sortOrder: number;
	draft: string | null;
	final: string | null;
};

export type EditorialForFirestore = {
	intro: NarrationPartForFirestore;
	outro: NarrationPartForFirestore;
	impressions: Record<string, ImpressionPartForFirestore>;
};

// 個別再生成の対象となる記事要素。共通入口 onCall（regenerateArticleElement）の request に渡す。
export type ArticleElement =
	| { kind: 'chapter'; chapterId: string }
	| { kind: 'intro' }
	| { kind: 'outro' }
	| { kind: 'impression'; personaId: string };

// 記事の読み取りモデル（非永続）。編集後があれば final、無く原本があれば draft_only、どちらも無ければ missing。
export type ElementStatus = 'final' | 'draft_only' | 'missing';
