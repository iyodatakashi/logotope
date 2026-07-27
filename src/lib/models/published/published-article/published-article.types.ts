// 公開記事の読み取り専用の出力型（射影の成果物）。読み取り入力は Admin 永続型（*ForFirestore）を
// 境界で cast して参照する（published-article.ts）。このファイルは公開出力の型と型ガードのみに保つ。
//
// 話者は名前・肩書を各要素へ焼き込まず personaId で参照し、描画時に personas から解決する
// （管理側 personasStore.personaMap と同じ「id で保持し描画時に解決」）。

// 話者ペルソナは Admin・公開共通の表示型 PersonaForDisplay に統合した（公開専用の PublishedPersona は廃止）。
import type { PersonaForDisplay } from '$lib/models/persona/persona.types';

// 気づき。ターンの由来から集約する。誰の気づきかは personaId で参照する。
export type PublishedAwareness = {
	personaId: string;
	content: string;
};

// 1 ターン（発言）。読み物本文・話者参照・気づきのみを持ち、診断注釈（factCheck / engagementScore / speechMode 等）は含めない。
export type PublishedTurn = {
	id: string;
	personaId: string | null; // null はペルソナに解決できない話者（ファシリテーター）
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
	content: string; // final ?? draft
};

// 記事全体。topic を集約ルートとする派生ビュー。
export type PublishedArticle = {
	id: string;
	title: string;
	publishedAt: Date;
	intro: PublishedNarration | null; // 内容が無ければ null（非表示）
	outro: PublishedNarration | null;
	personas: Map<string, PersonaForDisplay>; // id → ペルソナ。話者解決の単一の情報源
	chapters: PublishedChapter[];
	impressions: PublishedImpression[];
};
