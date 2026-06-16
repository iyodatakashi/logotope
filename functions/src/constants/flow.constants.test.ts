import { describe, it, expect } from 'vitest';
import {
	INTENT_EXPIRY_TURNS,
	HIGH_ENGAGEMENT_SCORE,
	ACTIVE_SIGNAL_STRONG_SCORE,
	MAX_PAIR_CONVERSATION_TURNS,
	DEFAULT_INTERVENTION_COOLDOWN,
	TURNS_PER_CHAPTER,
	MAX_TURNS,
	RECENT_SIGNAL_WINDOW,
	EARLY_END_PROGRESS_RATIO,
	TURN_CAP_RATIO
} from './flow.constants';

describe('flow/constants', () => {
	it('フロー制御定数を単一の定義元から提供する', () => {
		expect(INTENT_EXPIRY_TURNS).toBe(8);
		expect(HIGH_ENGAGEMENT_SCORE).toBe(4);
		expect(ACTIVE_SIGNAL_STRONG_SCORE).toBe(5);
		expect(MAX_PAIR_CONVERSATION_TURNS).toBe(3);
		expect(DEFAULT_INTERVENTION_COOLDOWN).toBe(2);
		expect(TURNS_PER_CHAPTER).toBe(15);
		expect(MAX_TURNS).toBe(200);
		expect(RECENT_SIGNAL_WINDOW).toBe(5);
		expect(EARLY_END_PROGRESS_RATIO).toBe(0.75);
		expect(TURN_CAP_RATIO).toBe(1.5);
	});

	it('高意欲境界はキュー追加（>=）とキュー選択（<）で同一の境界を共有する', () => {
		// 同一定数を逆向きに使うことで境界の取り違えを防ぐ
		expect(HIGH_ENGAGEMENT_SCORE).toBe(4);
		expect(HIGH_ENGAGEMENT_SCORE).toBeLessThan(ACTIVE_SIGNAL_STRONG_SCORE);
	});
});
