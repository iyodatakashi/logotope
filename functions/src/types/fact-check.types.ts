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

export type FactCheckResultForFirestore = {
	chapterId: string;
	status: FactCheckStatus;
	findings: FactCheckFinding[];
	sources: SearchResult[]; // 章全体で参照した出典（finding 突合のフォールバック）
	errorMessage?: string;
	startedAt: Timestamp;
	completedAt?: Timestamp;
};
