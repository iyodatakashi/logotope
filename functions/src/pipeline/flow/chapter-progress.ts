import {
  RECENT_SIGNAL_WINDOW,
  EARLY_END_PROGRESS_RATIO,
  TURN_CAP_RATIO,
  ACTIVE_SIGNAL_STRONG_SCORE,
} from './constants.js';
import { isHighEngagement } from './speaker-selection.js';

/** 評価結果から活性シグナルを算出する。評価スキップターン（評価なし）は常に 1 とする */
export const toEngagementSignal = (
  assessments: ReadonlyArray<{ score: number; mode: 'opinion' | 'fact' | 'none' }>
): 0 | 1 => {
  if (assessments.length === 0) return 1;
  const hasActiveEngagement = assessments.some(
    a => ((a.mode === 'opinion' || a.mode === 'fact') && isHighEngagement(a))
      || a.score >= ACTIVE_SIGNAL_STRONG_SCORE
  );
  return hasActiveEngagement ? 1 : 0;
};

export interface ChapterEndInput {
  chapterTurnCount: number;
  targetTurns: number;
  engagementSignals: ReadonlyArray<0 | 1>;
}

/** 目標の75%消化かつ直近5シグナルすべて非活性で true（シグナル5件未満は必ず false） */
export const shouldEndChapterEarly = (input: ChapterEndInput): boolean => {
  const { chapterTurnCount, targetTurns, engagementSignals } = input;
  if (engagementSignals.length < RECENT_SIGNAL_WINDOW) return false;
  if (chapterTurnCount < Math.ceil(targetTurns * EARLY_END_PROGRESS_RATIO)) return false;
  return engagementSignals.slice(-RECENT_SIGNAL_WINDOW).every(signal => signal === 0);
};

/** 章の強制終了上限 = ceil(targetTurns * 1.5) */
export const chapterTurnCap = (targetTurns: number): number =>
  Math.ceil(targetTurns * TURN_CAP_RATIO);
