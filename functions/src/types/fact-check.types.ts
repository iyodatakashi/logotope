import type { Timestamp } from 'firebase-admin/firestore';
import type { SearchResult } from '../search/grounding.js';

export type FactCheckStatus = 'running' | 'completed' | 'failed';

export type FactCheckVerdict = 'incorrect' | 'unverifiable';

export type FactCheckFinding = {
	id: string;
	turnId: string; // 対象発言（2.3, 4.2）
	speakerType: 'persona' | 'facilitator';
	claim: string; // 該当箇所（発言からの引用）
	verdict: FactCheckVerdict;
	correction: string; // 正しい事実（incorrect 時）／unverifiable は空可
	reason: string; // そう判断した理由
	sources: SearchResult[]; // 出典（3.4）
};

// 検証対象の発言が属する討論の文脈（テーマ・章）。発言を単独で検証すると一般論に流れるため必須。
export type FactCheckContext = {
	topicTitle: string;
	chapterTitle: string;
	discussionScope: string; // 話題スコープ補足（インライン: アクティブ論点 ?? 章タイトル, 章バッチ: 章タイトル）
	currentDate: string; // 時間軸検証の基準（currentDateString() 由来＝実行開始時刻, 3.5）
};

export type FactCheckResultForFirestore = {
	chapterId: string;
	status: FactCheckStatus;
	findings: FactCheckFinding[];
	sources: SearchResult[]; // 章全体で参照した出典（finding 突合のフォールバック）
	errorMessage?: string;
	startedAt: Timestamp;
	completedAt?: Timestamp;
};
