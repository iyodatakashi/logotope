/**
 * discussion-point-consolidation の結合・回帰検証（タスク6）。
 * - 章開始 → オープニングが先頭論点を introduced 化 → 後続の文脈解決でアクティブ論点が入る。
 * - 介入で未提示論点を投入 → それが新しいアクティブ論点になり、次の drift 評価の基準（activeFocus）が更新される。
 * - introducedOrder 未採番（移行期データ）でも getActiveDiscussionPoint がエラーにならない。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DebateState } from '../../../types/debate.types.js';
import type { DebateTurn } from '../../../types/turn.types.js';
import type { Persona } from '../../../types/persona.types.js';
import type { Chapter } from '../../../types/chapter.types.js';

const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue({ update: mockUpdate });

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc })),
	Timestamp: { now: vi.fn(() => ({ toDate: () => new Date() })) },
	FieldValue: { arrayUnion: vi.fn((...args: unknown[]) => args), delete: vi.fn(() => 'DELETE') }
}));

vi.mock('../../../agents/facilitator-agent.js', () => ({
	evaluateTopicDrift: vi.fn(),
	evaluateStallIntervention: vi.fn()
}));
vi.mock('../../../pipeline/debate/speaker-selection.js', () => ({
	hasHighEngagement: vi.fn(() => false)
}));
vi.mock('../../../pipeline/debate/queued-intents.js', () => ({
	addQueuedIntents: vi.fn().mockResolvedValue(undefined)
}));
const mockAddTurnFn = vi.fn().mockResolvedValue({ status: 'committed', id: 'turn-new' });
vi.mock('../../../pipeline/debate/turn.js', () => ({
	addTurn: (...args: unknown[]) => mockAddTurnFn(...args)
}));
vi.mock('../../../pipeline/debate/utils.js', () => ({
	pipelineErrorMessage: vi.fn((e: { message: string }) => e.message),
	validPersonaId: vi.fn((id: string | undefined) => id)
}));

import {
	getActiveDiscussionPoint,
	markIntroduced,
	initDiscussionPoints
} from '../../../pipeline/debate/discussion-points.js';

const mockPersonas: Persona[] = [{ id: 'p1', name: 'テスト' } as Persona];
const mockChapter: Chapter = { id: 'ch1', title: '章', discussionPoints: ['A', 'B', 'C'] };

const makeTurn = (speakerType: 'persona' | 'facilitator', id: string): DebateTurn => ({
	id,
	speakerType,
	content: 'test',
	createdAt: ''
});

const makeState = (
	turns: DebateTurn[],
	discussionPoints: DebateState['discussionPoints']
): DebateState =>
	({
		turns: [...turns],
		lastSpeakerId: undefined,
		silenceMap: new Map(),
		speakCount: new Map(),
		queuedIntents: new Map(),
		discussionPoints
	}) as DebateState;

describe('結合: 章開始 → オープニングが先頭論点を提示 → 後続文脈にアクティブ論点が入る', () => {
	it('オープニングの markIntroduced(0) で先頭論点が introduced 化し getActiveDiscussionPoint が返す', () => {
		const chapter: Chapter = { id: 'ch1', title: '章', discussionPoints: ['先頭論点', '次の論点'] };
		const state = makeState([], initDiscussionPoints(chapter));

		// 章開始時、全論点は untouched
		expect(getActiveDiscussionPoint(state)).toBeUndefined();

		// オープニングは untouched 候補リストの index=0 を提示する
		markIntroduced(state, 0);

		// 後続ターン（turn.ts）が参照するアクティブ論点が先頭論点になる
		expect(getActiveDiscussionPoint(state)).toBe('先頭論点');
		expect(state.discussionPoints[0].status).toBe('introduced');
		expect(state.discussionPoints[0].introducedOrder).toBe(1);
	});

	it('論点を持たない章では章開始後もアクティブ論点は不在（呼び出し側が title へフォールバック）', () => {
		const chapter: Chapter = { id: 'ch1', title: 'タイトルのみ章', discussionPoints: [] };
		const state = makeState([], initDiscussionPoints(chapter));
		markIntroduced(state, undefined);
		expect(getActiveDiscussionPoint(state)).toBeUndefined();
	});
});

describe('結合: 介入で未提示論点を投入 → 新しいアクティブ論点になり drift 基準が更新される', () => {
	let evaluateTopicDrift: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		const mod = await import('../../../agents/facilitator-agent.js');
		evaluateTopicDrift = vi.mocked(mod.evaluateTopicDrift);
	});

	const cooldownReadyTurns = [
		makeTurn('facilitator', 'f1'),
		makeTurn('persona', 'p1'),
		makeTurn('persona', 'p2')
	];

	it('投入された未提示論点が introduced 化し getActiveDiscussionPoint が返す', async () => {
		evaluateTopicDrift.mockResolvedValueOnce({
			ok: true,
			value: { content: '次の論点を投入', targetPersonaId: 'p1', selectedDiscussionPointIndex: 0 }
		});

		// A は提示済み、B/C は未提示。untouched 候補は [B, C]
		const state = makeState(cooldownReadyTurns, [
			{ point: 'A', status: 'introduced', introducedOrder: 1 },
			{ point: 'B', status: 'untouched' },
			{ point: 'C', status: 'untouched' }
		]);

		const { tryIntervention } = await import('../../../pipeline/debate/intervention.js');
		await tryIntervention({
			topicId: 'topic1',
			personas: mockPersonas,
			chapter: mockChapter,
			state,
			engagements: [],
			interventionCooldown: 2,
			trigger: { kind: 'no-target' }
		});

		// 投入論点 B が introduced になり、最新のアクティブ論点として解決される
		expect(state.discussionPoints[1].status).toBe('introduced');
		expect(getActiveDiscussionPoint(state)).toBe('B');
	});

	it('最新の introduced 論点が次の drift 評価に activeFocus として渡る', async () => {
		// 引き戻し介入（論点投入なし）で発火させ、stall へカスケードさせない
		evaluateTopicDrift.mockResolvedValueOnce({
			ok: true,
			value: { content: 'B に引き戻す', targetPersonaId: 'p1' }
		});

		// B が最後に投入された論点（order 2）→ アクティブ論点は B
		const state = makeState(cooldownReadyTurns, [
			{ point: 'A', status: 'introduced', introducedOrder: 1 },
			{ point: 'B', status: 'introduced', introducedOrder: 2 },
			{ point: 'C', status: 'untouched' }
		]);

		const { tryIntervention } = await import('../../../pipeline/debate/intervention.js');
		await tryIntervention({
			topicId: 'topic1',
			personas: mockPersonas,
			chapter: mockChapter,
			state,
			engagements: [],
			interventionCooldown: 2,
			trigger: { kind: 'no-target' }
		});

		// drift の判断軸（5番目の引数 activeFocus）が新しいアクティブ論点 B に更新されている
		expect(evaluateTopicDrift).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			'B',
			['C'],
			undefined
		);
	});
});

describe('回帰: introducedOrder 未採番（移行期データ）でもアクティブ論点解決がエラーにならない', () => {
	it('order を持たない introduced 論点でも例外を投げず1件を返す', () => {
		const state = makeState(
			[],
			[
				{ point: 'A', status: 'introduced' },
				{ point: 'B', status: 'introduced' }
			]
		);
		expect(() => getActiveDiscussionPoint(state)).not.toThrow();
		expect(getActiveDiscussionPoint(state)).toBeDefined();
	});
});
