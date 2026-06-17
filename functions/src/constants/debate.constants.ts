/** 討論制御に使う閾値・上限・比率の単一定義元。値の定義のみを持ち、ロジックは持たない */

/** 意図キューの失効ターン数 */
export const INTENT_EXPIRY_TURNS = 8;

/** 発言意図キュー追加の閾値 */
export const QUEUE_THRESHOLD_SCORE = 4;

/** 自発発言が成立する閾値。話者選択ゲート・スタール判定で使用 */
export const SPEAK_THRESHOLD_SCORE = 3;

/** 章継続の活性シグナル閾値 */
export const CONTINUE_CHAPTER_THRESHOLD = 4;

/** ペルソナ間の連続直接質問の上限 */
export const MAX_PAIR_CONVERSATION_TURNS = 3;

/** 介入クールダウン既定ターン数（ドリフト・スタール共通） */
export const DEFAULT_INTERVENTION_COOLDOWN = 2;

/** 1章あたりの目標ターン数（既定） */
export const TURNS_PER_CHAPTER = 15;

/** 討論全体のターン上限（既定） */
export const MAX_TURNS = 200;

/** checkChapterContinuation が連続 false になった場合に章を早期終了するカウント上限 */
export const CHAPTER_END_COUNT_LIMIT = 5;

/** 早期終了の進捗比率（目標ターンの何割消化で打ち切り判定に入るか） */
export const EARLY_END_PROGRESS_RATIO = 0.75;

/** 章の強制終了上限の比率（目標ターンに対する倍率） */
export const TURN_CAP_RATIO = 1.5;
