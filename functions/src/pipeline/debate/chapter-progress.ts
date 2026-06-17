import {
	CHAPTER_END_COUNT_LIMIT,
	EARLY_END_PROGRESS_RATIO,
	TURN_CAP_RATIO,
	CONTINUE_CHAPTER_THRESHOLD
} from '../../constants/flow.constants.js';

/** 評価結果から章継続判定を行う。評価スキップターン（評価なし）は常に true とする */
export const checkChapterContinuation = (
	engagements: ReadonlyArray<{ score: number }>
): boolean => {
	if (engagements.length === 0) return true;
	return engagements.some((a) => a.score >= CONTINUE_CHAPTER_THRESHOLD);
};

/** 目標の75%消化かつ checkChapterContinuation が CHAPTER_END_COUNT_LIMIT 回連続 false で true */
export const hasReachedEarlyEnd = (
	chapterTurnCount: number,
	targetTurns: number,
	chapterEndCount: number
): boolean => {
	if (chapterTurnCount < Math.ceil(targetTurns * EARLY_END_PROGRESS_RATIO)) return false;
	return chapterEndCount >= CHAPTER_END_COUNT_LIMIT;
};

/** 章の強制終了上限 = ceil(targetTurns * 1.5) */
export const chapterTurnCap = (targetTurns: number): number =>
	Math.ceil(targetTurns * TURN_CAP_RATIO);
