import { Timestamp } from 'firebase/firestore';

export type SpeakerType = 'facilitator' | 'persona';

export type FactCheckVerdict = 'incorrect' | 'unverifiable';

export type FactCheckSource = { title: string; url: string };

// インライン検証で検出した事実誤り指摘。ターンに埋め込まれる Firestore 永続形のミラー。
export type FactCheckFinding = {
	id: string;
	turnId: string;
	speakerType: 'persona' | 'facilitator';
	claim: string;
	verdict: FactCheckVerdict;
	correction: string;
	reason: string;
	sources: FactCheckSource[];
};

// インライン検証・補正の監査トレース（ターンに埋め込み）。表示 UI は本仕様の対象外（型整合のみ）。
export type TurnFactCheckTrace = {
	status: 'checked' | 'unverified';
	revised: boolean;
	findings: FactCheckFinding[];
	originalContent?: string;
};

export type TurnForFirestore = {
	id: string;
	speakerType: SpeakerType;
	personaId?: string;
	content: string;
	createdAt: Timestamp;
	speechMode?: 'opinion' | 'fact';
	engagementScore?: number;
	fromQueue?: boolean;
	targetPersonaId?: string;
	factCheck?: TurnFactCheckTrace;
};

export type Turn = Omit<TurnForFirestore, 'createdAt'> & { createdAt: Date };

// --- 編集フェーズで整形されるターン型（原本 Turn から派生する成果物・表示形をここに集約する）---

// 編集後ターン。散文・発話者・由来のみを持ち、信念変化・ファクトチェック等の注釈は
// 原本を真実として sourceTurnIds で join 表示する。Timestamp を持たず永続形＝実行時形なので単一型にする。
export type EditedTurn = {
	id: string;
	sourceTurnIds: string[]; // 由来する原本ターン id（>=1、連結時は複数）
	speakerType: SpeakerType;
	personaId?: string | null;
	content: string;
	speechMode?: 'opinion' | 'fact' | 'question';
};

// 編集画面の差分レビュー1行。編集後ターン（連結あり）または削除された原本ターンを表す。
// Turn と責務範囲をそろえ、話者は id 参照のまま（name/role は描画時解決）、差分・気づきも畳まず
// 描画時に sourceTurnIds から算出/参照する。EditedTurn を削除フラグだけ拡張する。
export type TurnForEditing = EditedTurn & {
	removed: boolean; // 編集後に使われず削除された原本ターンか（差分表示時のみ取り消し線で出す）
};
