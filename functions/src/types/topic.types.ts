import type { Timestamp } from 'firebase-admin/firestore';

// 永続する phase の slug 型（FE PhaseSlug と値集合・順序を一致させる）。
// 正準 slug リスト（順序込み）:
// ['fact-research', 'stakeholders', 'personas', 'interviews', 'chapters', 'debate', 'editing']
export type PhaseKey =
	| 'fact-research'
	| 'stakeholders'
	| 'personas'
	| 'interviews'
	| 'chapters'
	| 'debate'
	| 'editing';

export type FetchedSourceContent = {
	url: string;
	content: string;
	fetchedAt: Timestamp;
};

// 検証可能な客観的事実1件（statement）と、その出典。
export type FactItem = {
	statement: string;
	sources: { title: string; url: string }[];
};

// トピック事実基盤（アプリ層型）。facts が空配列＝事実なし（縮退）。
// generatedAt は生成基準日（現在日付）。
export type FactBase = {
	facts: FactItem[];
	generatedAt: Date;
};

// 事実基盤の Firestore 永続型（topics/{id}/factBase/0）。
export type FactBaseForFirestore = {
	facts: FactItem[];
	generatedAt: Timestamp;
};

export type TopicContext = {
	description?: string;
	sourceContents?: string[];
	// 承認済み事実基盤（共通前提）。ユーザー提供資料（sourceContents）とは別データ。
	factBase?: FactBase;
};

export type Topic = {
	id: string;
	title: string;
	description?: string;
	sourceUrls?: string[];
	fetchedSourceContents?: FetchedSourceContent[];
	createdAt: Timestamp;
	updatedAt: Timestamp;
};
