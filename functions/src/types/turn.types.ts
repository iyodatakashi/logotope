import type { Timestamp } from 'firebase-admin/firestore';
import type { Chapter, AgendaItemState } from './chapter.types.js';
import type { FactCheckFinding, FactCheckVerdict } from './fact-check.types.js';
import type { FactBase } from './factBase.types.js';

// インライン検証・補正の監査トレース。対象発言（ターン）に co-located で埋め込む。
export type TurnFactCheckTrace = {
	status: 'checked' | 'unverified'; // unverified = 検証未完了で登録（フォールバック）
	revised: boolean; // 再生成して補正したか
	findings: FactCheckFinding[]; // フィードバックした指摘（turnId は空。後追い反映時に復元）
	originalContent?: string; // 補正前ドラフト（revised:true のときのみ）
};

// 再生成時にペルソナへ渡す指摘フィードバック（主張・判定・訂正・理由）
export type TurnFactCheckFeedback = ReadonlyArray<{
	claim: string;
	verdict: FactCheckVerdict;
	correction: string;
	reason: string;
}>;

// 反応（engagement/awareness）評価中のみ付与。確定・評価完了後は undefined（＝完了）。
export type TurnStatus = 'evaluating';

export type DebateTurn = {
	id: string;
	speakerType: string;
	personaId?: string | null;
	content: string;
	createdAt: Timestamp;
	speechMode?: 'opinion' | 'fact' | 'question';
	engagementScore?: number;
	fromQueue?: boolean;
	targetPersonaId?: string;
	targetedBy?: 'facilitator' | 'persona';
	searchUsed?: boolean;
	searchQueries?: string[];
	factCheck?: TurnFactCheckTrace;
	status?: TurnStatus;
};

export type NewTurnFields = {
	speakerType: 'persona' | 'facilitator';
	personaId?: string;
	content: string;
	speechMode?: 'opinion' | 'fact' | 'question';
	engagementScore?: number;
	fromQueue?: boolean;
	targetPersonaId?: string;
	targetedBy?: 'facilitator' | 'persona';
	searchUsed?: boolean;
	searchQueries?: string[];
	factCheck?: TurnFactCheckTrace;
	status?: TurnStatus;
};

export type ProgressPatch = {
	quietStreak?: number;
	agendaItemStatuses?: AgendaItemState[];
};

export type AppendTurnInput = {
	topicId: string;
	chapterId: string;
	expectedTurnIndex: number;
	turn: NewTurnFields;
	runId?: string;
	progressPatch?: ProgressPatch;
	// 生成開始時に発番した id（pendingTurn 経路）。未指定時はトランザクション内で発番する。
	id?: string;
};

export type AppendResult =
	| { status: 'committed'; id: string }
	| { status: 'rejected'; reason: 'index_mismatch' | 'generation_mismatch' | 'debate_inactive' };

export type TurnGenerationContext = {
	chapterTurns: ReadonlyArray<DebateTurn>;
	chapter: Chapter;
	activeAgendaItem?: string;
	queuedTrigger?: { speakerName: string; content: string };
	targetedBy?: 'facilitator' | 'persona';
	otherPersonas?: ReadonlyArray<{ id: string; name: string }>;
	factCheckFeedback?: TurnFactCheckFeedback;
	// 承認済み事実基盤（共通前提）。件数ノルマは課さず、関与濃淡はプロフィール・関心度に委ねる（R8）。
	factBase?: FactBase;
};

// --- 編集後ターン（編集フェーズの成果物・editorial から集約）。FE turn.types の EditedTurn と同粒度で並行 ---

// 由来ターンID群は 1 件以上を必須とし、連結時は複数を許容する不変条件を型で表現する。
export type NonEmptyArray<T> = [T, ...T[]];

export const isNonEmptyArray = <T>(value: readonly T[]): value is NonEmptyArray<T> =>
	value.length >= 1;

// 編集後ターン: 散文・発話者・由来。注釈（信念変化/ファクトチェック）は持たず原本を参照する。
export type EditedTurnForFirestore = {
	id: string; // nanoid（編集ターンの新規 id）
	sourceTurnIds: NonEmptyArray<string>; // 由来する原本ターン id（>=1、連結時は複数）
	speakerType: 'persona' | 'facilitator';
	personaId?: string | null;
	content: string; // 編集後の散文
	speechMode?: 'opinion' | 'fact' | 'question';
};
