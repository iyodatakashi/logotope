import type { Chapter, ChapterEntry } from './chapter.types.js';
import type { Persona } from './persona.types.js';
import type { DebateState } from './debate.types.js';

export type StepKind = 'open' | 'turn' | 'chapter-end';

export type StepPayload = {
	topicId: string;
	chapterIndex: number;
	runId: string;
	stepKind: StepKind;
	expectedTurnIndex: number;
	singleChapterMode?: boolean;
	// 章末の未応答指名に対する最終応答（+1）ターンであることを示す。処理後は chapter-end へ直行する
	finalResponse?: boolean;
};

export type NextStep =
	| { kind: 'turn'; expectedTurnIndex: number; finalResponse?: boolean }
	| { kind: 'chapter-end'; expectedTurnIndex: number }
	| { kind: 'open'; chapterIndex: number; expectedTurnIndex: 0 };

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
	isLastChapter: boolean; // この章が最終章か（true なら chapter-end で討論を generated 確定、false なら次章 open）
};

/**
 * performTurnStep が「何が起きたか」を表現して返す実行結果（「次に何をするか」は含まない）。
 * 次ステップの決定は advanceDebate が dispatch した stepKind と本結果から行う。
 */
export type TurnExecution =
	| { status: 'completed' } // 章は既に完了 → 何もしない
	| { status: 'conflict' } // 追記競合/停止 → resumeFromFresh
	| { status: 'stale_generation' } // 世代交代を addTurn が検出 → resume せず終了（R9）
	| { status: 'advanced'; quietStreak: number }; // 実行コミット or frontier 前進 → 次へ
