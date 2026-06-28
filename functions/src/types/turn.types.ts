import type { Timestamp } from 'firebase-admin/firestore';
import type { Chapter, DiscussionPointState } from './chapter.types.js';
import type { FactCheckFinding, FactCheckVerdict } from './fact-check.types.js';

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
};

export type ProgressPatch = {
	quietStreak?: number;
	discussionPointStatuses?: DiscussionPointState[];
};

export type AppendTurnInput = {
	topicId: string;
	chapterId: string;
	expectedTurnIndex: number;
	turn: NewTurnFields;
	runId?: string;
	progressPatch?: ProgressPatch;
};

export type AppendResult =
	| { status: 'committed'; id: string }
	| { status: 'rejected'; reason: 'index_mismatch' | 'generation_mismatch' | 'debate_inactive' };

export type TurnGenerationContext = {
	chapterTurns: ReadonlyArray<DebateTurn>;
	chapter: Chapter;
	activeDiscussionPoint?: string;
	queuedTrigger?: { speakerName: string; content: string };
	targetedBy?: 'facilitator' | 'persona';
	otherPersonas?: ReadonlyArray<{ id: string; name: string }>;
	factCheckFeedback?: TurnFactCheckFeedback;
};
