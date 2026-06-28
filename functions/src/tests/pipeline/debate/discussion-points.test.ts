import { describe, it, expect } from 'vitest';
import {
	markIntroduced,
	getActiveDiscussionPoint
} from '../../../pipeline/debate/discussion-points.js';
import type { DebateState } from '../../../types/debate.types.js';
import type { DiscussionPointState } from '../../../types/chapter.types.js';

const makeState = (points: DiscussionPointState[]): DebateState =>
	({ discussionPoints: points }) as DebateState;

describe('getActiveDiscussionPoint', () => {
	it('提示済み論点が複数あるとき提示連番が最大の1件を返す', () => {
		const state = makeState([
			{ point: '論点A', status: 'introduced', introducedOrder: 1 },
			{ point: '論点B', status: 'introduced', introducedOrder: 3 },
			{ point: '論点C', status: 'introduced', introducedOrder: 2 }
		]);

		expect(getActiveDiscussionPoint(state)).toBe('論点B');
	});

	it('提示済みが無いとき undefined を返す', () => {
		const state = makeState([
			{ point: '論点A', status: 'untouched' },
			{ point: '論点B', status: 'addressed' }
		]);

		expect(getActiveDiscussionPoint(state)).toBeUndefined();
	});

	it('addressed は除外し introduced のみを対象とする', () => {
		const state = makeState([
			{ point: '論点A', status: 'addressed', introducedOrder: 5 },
			{ point: '論点B', status: 'introduced', introducedOrder: 2 }
		]);

		expect(getActiveDiscussionPoint(state)).toBe('論点B');
	});
});

describe('markIntroduced', () => {
	it('提示した論点を introduced にし introducedOrder を採番する', () => {
		const state = makeState([
			{ point: '論点A', status: 'untouched' },
			{ point: '論点B', status: 'untouched' }
		]);

		markIntroduced(state, 1);

		expect(state.discussionPoints[1].status).toBe('introduced');
		expect(state.discussionPoints[1].introducedOrder).toBe(1);
	});

	it('複数提示で introducedOrder が単調増加し、直近を一意に識別できる', () => {
		const state = makeState([
			{ point: '論点A', status: 'untouched' },
			{ point: '論点B', status: 'untouched' },
			{ point: '論点C', status: 'untouched' }
		]);

		// untouched/introduced を含む「未消化リスト」上の index で提示される
		markIntroduced(state, 0); // 論点A → order 1
		markIntroduced(state, 1); // 論点B → order 2
		markIntroduced(state, 2); // 論点C → order 3

		const latest = state.discussionPoints
			.filter((p) => p.status === 'introduced')
			.reduce((a, b) => ((b.introducedOrder ?? 0) > (a.introducedOrder ?? 0) ? b : a));
		expect(latest.point).toBe('論点C');
	});

	it('index が undefined のとき何もしない', () => {
		const state = makeState([{ point: '論点A', status: 'untouched' }]);
		markIntroduced(state, undefined);
		expect(state.discussionPoints[0].status).toBe('untouched');
		expect(state.discussionPoints[0].introducedOrder).toBeUndefined();
	});

	it('候補は未提示（untouched）のみで、提示済み論点は index 空間から除外する', () => {
		const state = makeState([
			{ point: '論点A', status: 'introduced', introducedOrder: 1 },
			{ point: '論点B', status: 'untouched' },
			{ point: '論点C', status: 'untouched' }
		]);

		// untouched のみの候補リスト [論点B, 論点C] の index 0 は 論点B を指す
		markIntroduced(state, 0);

		expect(state.discussionPoints[1].status).toBe('introduced');
		expect(state.discussionPoints[1].introducedOrder).toBe(2);
		// 既に introduced の論点A は再採番されない
		expect(state.discussionPoints[0].introducedOrder).toBe(1);
		expect(state.discussionPoints[2].status).toBe('untouched');
	});
});
