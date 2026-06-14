/**
 * 討論フロー制御に使う閾値・上限・比率の単一定義元。
 * 値の定義のみを持ち、ロジックは持たない。各 flow 純関数と orchestrator から参照する。
 */

/** 意図キューの失効ターン数（state-restore とキュー保守で共有） */
export const INTENT_EXPIRY_TURNS = 8;

/** 高意欲の下限スコア。>= で高意欲/キュー追加、< でキュー選択（同一境界を逆向きに使う） */
export const HIGH_ENGAGEMENT_SCORE = 4;

/** mode に依らず活性シグナルとみなすスコア */
export const ACTIVE_SIGNAL_STRONG_SCORE = 5;

/** ペルソナ間の連続直接質問の上限 */
export const MAX_CONSECUTIVE_DIRECT = 3;

/** 論点ずれ介入(A)のクールダウン既定ターン数 */
export const DEFAULT_INTERVENTION_COOLDOWN = 2;

/** 1章あたりの目標ターン数（既定） */
export const TURNS_PER_CHAPTER = 15;

/** 討論全体のターン上限（既定） */
export const MAX_TURNS = 200;

/** 早期終了判定で参照する直近シグナル窓 */
export const RECENT_SIGNAL_WINDOW = 5;

/** 早期終了の進捗比率（目標ターンの何割消化で打ち切り判定に入るか） */
export const EARLY_END_PROGRESS_RATIO = 0.75;

/** 章の強制終了上限の比率（目標ターンに対する倍率） */
export const TURN_CAP_RATIO = 1.5;
