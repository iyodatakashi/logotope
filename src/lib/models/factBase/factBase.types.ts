import type { Timestamp } from 'firebase/firestore';

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
