import type { Timestamp } from 'firebase-admin/firestore';
import type { Chapter } from './chapter.types.js';
import type { Persona } from './persona.types.js';

export type BeliefChangeType = 'opinion_change' | 'partial_acceptance';
export type BeliefChangeEvent = {
	type: BeliefChangeType;
	summary: string;
	updatedBelief: string;
};

export type DebateOptions = {
	turnsPerChapter: number;
	maxTurns: number;
	interventionCooldown: number;
	singleChapterMode?: boolean;
};

export type DebateSession = {
	id: string;
	topicId: string;
};

export type DiscussionPointStatus = 'untouched' | 'introduced' | 'addressed';

export type DiscussionPointState = {
	point: string;
	status: DiscussionPointStatus;
};

export type ChapterProgressStatus = 'pending' | 'running' | 'completed';

export type ChapterForFirestore = {
	chapterIndex: number;
	title: string;
	focusQuestion: string;
	discussionPoints: string[];
	turns: DebateTurn[];
	discussionPointStatuses?: DiscussionPointState[];
	quietStreak?: number;
	status: ChapterProgressStatus;
};

export type ChapterProgress = {
	quietStreak: number;
	discussionPointStatuses: DiscussionPointState[];
};

/**
 * 章ドキュメントを永続データから読み出したランタイム形。
 * 永続スキーマ ChapterForFirestore とは別物として併存させる（本スペックでは統一しない）。
 */
export type ChapterEntry = {
	id: string;
	chapterIndex: number;
	title: string;
	focusQuestion: string;
	discussionPoints: string[];
	turns: DebateTurn[];
	status: 'pending' | 'running' | 'completed';
};

export type DebateState = {
	turns: DebateTurn[];
	silenceMap: Map<string, number>;
	speakCount: Map<string, number>;
	lastSpeakerId?: string;
	queuedIntents: Map<string, QueuedIntent[]>;
	discussionPoints: DiscussionPointState[];
	runId?: string;
};

export type FacilitatorReply = {
	content?: string;
	targetPersonaId?: string;
	selectedDiscussionPointIndex?: number;
};

export type PersonaReply = {
	content: string;
	speechMode?: 'opinion' | 'fact' | 'question';
	beliefChange: BeliefChangeEvent | null;
	targetPersonaId?: string;
	searchUsed?: boolean;
	searchQueries?: string[];
};

export type Engagement = {
	personaId: string;
	score: number;
	mode: 'opinion' | 'fact' | 'none' | 'question';
	intentSummary?: string;
};

export type SpeakerSelection = {
	personaId: string;
	reason: 'targeted_by_facilitator' | 'targeted_by_persona' | 'queue' | 'score';
	intentSummary?: string;
};

export type QueuedIntent = {
	triggerTurnId: string;
	intentSummary: string;
};

export type TurnGenerationContext = {
	chapterTurns: ReadonlyArray<DebateTurn>;
	chapter: Chapter;
	queuedTrigger?: { speakerName: string; content: string };
	targetedBy?: 'facilitator' | 'persona';
	otherPersonas?: ReadonlyArray<{ id: string; name: string }>;
};

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
};

export type PostDebateCommentResult = {
	personaId: string;
	content: string;
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

export type TurnStepKind = 'open' | 'turn' | 'summary' | 'closing' | 'comments';

export type TurnStepPayload = {
	topicId: string;
	chapterIndex: number;
	runId: string;
	stepKind: TurnStepKind;
	expectedTurnIndex: number;
	singleChapterMode?: boolean;
	// 章末の未応答指名に対する最終応答（+1）ターンであることを示す。処理後は summary/closing へ直行する
	finalResponse?: boolean;
};

export type NextStep =
	| { kind: 'turn'; expectedTurnIndex: number; finalResponse?: boolean }
	| { kind: 'summary'; expectedTurnIndex: number }
	| { kind: 'closing'; expectedTurnIndex: number }
	| { kind: 'open'; chapterIndex: number; expectedTurnIndex: 0 }
	| { kind: 'comments' }
	| { kind: 'none' };

/** 1ステップ処理に必要な、永続データから再構築した一式のコンテキスト */
export type StepContext = {
	chapters: ChapterEntry[]; // トピックの全章
	chapterDoc: ChapterEntry; // 処理対象の章
	chapter: Chapter; // chapterDoc と同一（型を Chapter として扱う用）
	personas: Persona[]; // 承認済み参加ペルソナ
	topicTitle: string; // トピック名（プロンプト用）
	state: DebateState; // 全ターンから導出した討論状態（発言数・沈黙・キュー等）
	chapterTurnStartInState: number; // state.turns 内でこの章のターンが始まるオフセット
	quietStreak: number; // 盛り上がりが低いターンの連続数（早期終了判定用）
	isLastChapter: boolean; // この章が最終章か（true なら summary でなく closing へ）
};

/**
 * performTurnStep が「何が起きたか」を表現して返す実行結果（「次に何をするか」は含まない）。
 * 次ステップの決定は advanceDebate が dispatch した stepKind と本結果から行う。
 */
export type TurnExecution =
	| { status: 'completed' } // 章は既に完了 → 何もしない
	| { status: 'conflict' } // 追記競合/停止 → resumeFromFresh
	| { status: 'advanced'; quietStreak: number }; // 実行コミット or frontier 前進 → 次へ
