// 公開記事の読み取り専用の出力型（射影の成果物）。読み取り入力は Admin 永続型（*ForFirestore）を
// 境界で cast して参照する（published-article.ts）。このファイルは公開出力の型と型ガードのみに保つ。

// 気づき。ターンの由来から集約し、境界でペルソナ名を解決して焼き込む。
export type PublishedAwareness = {
	personaName: string;
	content: string;
};

// 1 ターン（発言）。読み物本文・話者・気づきのみを持ち、診断注釈（factCheck / engagementScore / speechMode 等）は含めない。
export type PublishedTurn = {
	id: string;
	speakerType: 'facilitator' | 'persona';
	speakerName: string; // ペルソナ名／ファシリテーター表記
	speakerRole: string; // specificRole ?? stakeholderRole。ファシリテーターは空
	content: string;
	awarenesses: PublishedAwareness[]; // 0 件ならアフォーダンス非表示
};

// 章。index は chapterIndex（安定キー・アンカー/目次に使用）。
export type PublishedChapter = {
	index: number;
	title: string;
	turns: PublishedTurn[];
};

// 導入/締めの本文（final ?? draft）。内容が無い要素は article 側で null を持つ。
export type PublishedNarration = string;

// ペルソナ 1 人分の所感。
export type PublishedImpression = {
	personaId: string;
	speakerName: string;
	speakerRole: string;
	content: string; // final ?? draft
};

// 記事全体。topic を集約ルートとする派生ビュー。
export type PublishedArticle = {
	id: string;
	title: string;
	publishedAt: Date;
	intro: PublishedNarration | null; // 内容が無ければ null（非表示）
	outro: PublishedNarration | null;
	chapters: PublishedChapter[];
	impressions: PublishedImpression[];
};
