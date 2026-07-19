import { describe, it, expect } from 'vitest';
import {
	INTENT_EXPIRY_TURNS,
	QUEUE_THRESHOLD_SCORE,
	SPEAK_THRESHOLD_SCORE,
	CONTINUE_CHAPTER_THRESHOLD,
	DEFAULT_INTERVENTION_COOLDOWN,
	TURNS_PER_CHAPTER,
	QUIET_STREAK_LIMIT,
	EARLY_END_PROGRESS_RATIO,
	TURN_CAP_RATIO,
	AGENDA_TURN_CAP_RATIO,
	INLINE_FACT_CHECK_TIMEOUT_MS
} from '../../constants/debate.constants';

describe('debate/constants', () => {
	it('討論制御定数を単一の定義元から提供する', () => {
		expect(INTENT_EXPIRY_TURNS).toBe(8);
		expect(SPEAK_THRESHOLD_SCORE).toBe(3);
		expect(QUEUE_THRESHOLD_SCORE).toBe(4);
		expect(CONTINUE_CHAPTER_THRESHOLD).toBe(4);
		expect(DEFAULT_INTERVENTION_COOLDOWN).toBe(3);
		expect(TURNS_PER_CHAPTER).toBe(15);
		expect(QUIET_STREAK_LIMIT).toBe(5);
		expect(EARLY_END_PROGRESS_RATIO).toBe(0.75);
		expect(TURN_CAP_RATIO).toBe(1.5);
	});

	it('SPEAK_THRESHOLD_SCORE < QUEUE_THRESHOLD_SCORE の順序を保つ', () => {
		expect(SPEAK_THRESHOLD_SCORE).toBeLessThan(QUEUE_THRESHOLD_SCORE);
	});

	it('論点リストありの章は既定より高いターン上限比率を使う', () => {
		expect(AGENDA_TURN_CAP_RATIO).toBe(2.5);
		expect(AGENDA_TURN_CAP_RATIO).toBeGreaterThan(TURN_CAP_RATIO);
	});

	it('インライン検証の上限時間は既定 120 秒（ミリ秒）', () => {
		expect(INLINE_FACT_CHECK_TIMEOUT_MS).toBe(120_000);
	});
});
