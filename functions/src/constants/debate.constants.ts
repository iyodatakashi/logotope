/** 討論制御に使う閾値・上限・比率の単一定義元。値の定義のみを持ち、ロジックは持たない */

/** 意図キューの失効ターン数 */
export const INTENT_EXPIRY_TURNS = 8;

/** 発言意図キュー追加の閾値 */
export const QUEUE_THRESHOLD_SCORE = 4;

/** 自発発言が成立する閾値。話者選択ゲートで使用 */
export const SPEAK_THRESHOLD_SCORE = 3;

/** スタール介入を抑止する高意欲閾値。この値以上の参加者がいれば出尽くし介入を行わない */
export const STALL_INTERVENTION_THRESHOLD_SCORE = 4;

/** 章継続の活性シグナル閾値 */
export const CONTINUE_CHAPTER_THRESHOLD = 4;

/** 介入クールダウン既定ターン数（ドリフト・スタール共通） */
export const DEFAULT_INTERVENTION_COOLDOWN = 3;

/** 1章あたりの目標ターン数（既定） */
export const TURNS_PER_CHAPTER = 15;

/** 討論全体のターン上限（既定） */
export const MAX_TURNS = 200;

/** 議論の沈静化（盛り上がりが低い状態）が連続したターン数の上限。これを超えたら章を早期終了する */
export const QUIET_STREAK_LIMIT = 5;

/** 早期終了の進捗比率（目標ターンの何割消化で打ち切り判定に入るか） */
export const EARLY_END_PROGRESS_RATIO = 0.75;

/** 章の強制終了上限の比率（目標ターンに対する倍率） */
export const TURN_CAP_RATIO = 1.5;

/** 論点リストが存在する章の強制終了上限の比率（論点消化を許容するため既定より高い） */
export const AGENDA_TURN_CAP_RATIO = 2.5;
