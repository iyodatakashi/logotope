/**
 * decideNextStep: 永続状態（章ローカルターン・章終了カウンタ・論点ステータス）のみから
 * 次ステップ種別と期待位置を決定する純関数のユニットテスト。
 */
import { describe, it, expect } from 'vitest';
import { decideNextStep } from '../../../pipeline/debate/debate-orchestrator.js';
import type { DebateOptions } from '../../../types/debate.types.js';
import type { DiscussionPointState } from '../../../types/chapter.types.js';
import type { DebateTurn } from '../../../types/turn.types.js';

const options: DebateOptions = { turnsPerChapter: 15, maxTurns: 200, interventionCooldown: 3 };

// cap: hasPoints → ceil(15*2.5)=38 / noPoints → ceil(15*1.5)=23
// earlyThreshold: ceil(15*0.75)=12, QUIET_STREAK_LIMIT=5

const personaTurn = (i: number, extra: Partial<DebateTurn> = {}): DebateTurn => ({
	id: `t${i}`,
	speakerType: 'persona',
	personaId: 'p1',
	content: `発言${i}`,
	createdAt: '',
	...extra
});

const turns = (n: number): DebateTurn[] => Array.from({ length: n }, (_, i) => personaTurn(i));

const base = (overrides: Partial<Parameters<typeof decideNextStep>[0]> = {}) => ({
	chapterTurns: turns(5),
	globalTurnCount: 5,
	quietStreak: 0,
	discussionPoints: [] as DiscussionPointState[],
	options,
	isLastChapter: false,
	...overrides
});

describe('decideNextStep', () => {
	it('cap・早期終了いずれも未成立なら turn を返し期待位置は章ローカル長', () => {
		const result = decideNextStep(base({ chapterTurns: turns(5), globalTurnCount: 5 }));
		expect(result).toEqual({ kind: 'turn', expectedTurnIndex: 5 });
	});

	it('cap 到達かつ最終章でなければ summary を返す', () => {
		const result = decideNextStep(base({ chapterTurns: turns(23), globalTurnCount: 23 }));
		expect(result).toEqual({ kind: 'summary', expectedTurnIndex: 23 });
	});

	it('cap 到達かつ最終章なら closing を返す', () => {
		const result = decideNextStep(
			base({ chapterTurns: turns(23), globalTurnCount: 23, isLastChapter: true })
		);
		expect(result).toEqual({ kind: 'closing', expectedTurnIndex: 23 });
	});

	it('globalTurnCount が maxTurns 以上なら章を終了する（summary）', () => {
		const result = decideNextStep(base({ chapterTurns: turns(10), globalTurnCount: 200 }));
		expect(result.kind).toBe('summary');
	});

	it('早期終了条件成立（進捗閾値超え＋カウンタ上限）なら summary を返す', () => {
		const result = decideNextStep(
			base({ chapterTurns: turns(13), globalTurnCount: 13, quietStreak: 5 })
		);
		expect(result).toEqual({ kind: 'summary', expectedTurnIndex: 13 });
	});

	it('早期終了の進捗閾値未満なら turn を返す（継続）', () => {
		const result = decideNextStep(
			base({ chapterTurns: turns(10), globalTurnCount: 10, quietStreak: 5 })
		);
		expect(result.kind).toBe('turn');
	});

	it('カウンタが上限未満（カバレッジ評価で 0 リセット相当）なら turn を返す（継続）', () => {
		const result = decideNextStep(
			base({ chapterTurns: turns(13), globalTurnCount: 13, quietStreak: 0 })
		);
		expect(result.kind).toBe('turn');
	});

	it('章終了でも末尾に未応答の指名が残る場合は最終応答ターン（turn）を1回挟む', () => {
		const chapterTurns = [
			...turns(22),
			personaTurn(22, { targetPersonaId: 'p2', targetedBy: 'persona' })
		];
		const result = decideNextStep(base({ chapterTurns, globalTurnCount: 23, isLastChapter: true }));
		expect(result).toEqual({ kind: 'turn', expectedTurnIndex: 23, finalResponse: true });
	});

	it('最終応答ターンが既に消費済み（末尾が直前指名への応答）なら closing/summary へ進む', () => {
		// 22: p2 を指名 / 23: p2 が応答（直前指名への応答 → +1 消費済み）
		const chapterTurns = [
			...turns(22),
			personaTurn(22, { personaId: 'p1', targetPersonaId: 'p2', targetedBy: 'persona' }),
			personaTurn(23, { personaId: 'p2' })
		];
		const result = decideNextStep(base({ chapterTurns, globalTurnCount: 24, isLastChapter: true }));
		expect(result).toEqual({ kind: 'closing', expectedTurnIndex: 24 });
	});

	it('論点ありの章は AGENDA_TURN_CAP_RATIO（cap=38）まで継続する', () => {
		const result = decideNextStep(
			base({
				chapterTurns: turns(30),
				globalTurnCount: 30,
				discussionPoints: [{ point: '論点A', status: 'introduced' }]
			})
		);
		// noPoints の cap=23 を超えても論点ありなら cap=38 で継続
		expect(result.kind).toBe('turn');
	});

	it('同一入力から常に同一の出力を返す（決定論）', () => {
		const args = base({ chapterTurns: turns(23), globalTurnCount: 23 });
		expect(decideNextStep(args)).toEqual(decideNextStep(args));
	});
});
