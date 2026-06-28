import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DebateState } from '../../../types/debate.types.js';
import type { DebateTurn } from '../../../types/turn.types.js';

const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue({ update: mockUpdate });

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc })),
	Timestamp: { now: vi.fn(() => ({ toDate: () => new Date() })) },
	FieldValue: { arrayUnion: vi.fn((...args: unknown[]) => args) }
}));

import {
	shouldEvaluateIntervention,
	countPersonaTurnsSinceFacilitator,
	countConsecutivePersonaTargets,
	persistInterventionTurn
} from '../../../pipeline/debate/intervention.js';

const makeTurn = (speakerType: 'persona' | 'facilitator', id: string): DebateTurn => ({
	id,
	speakerType,
	content: 'test',
	createdAt: ''
});

/** ペルソナ間指名ターン（targetedBy='persona'）を作る */
const makePersonaTargetTurn = (id: string, targetPersonaId = 'pX'): DebateTurn => ({
	id,
	speakerType: 'persona',
	content: 'test',
	createdAt: '',
	targetPersonaId,
	targetedBy: 'persona'
});

/** ファシリテーターによる指名ターン（targetedBy='facilitator'）を作る */
const makeFacilitatorTargetTurn = (id: string, targetPersonaId = 'pX'): DebateTurn => ({
	id,
	speakerType: 'persona',
	content: 'test',
	createdAt: '',
	targetPersonaId,
	targetedBy: 'facilitator'
});

const makeState = (
	turns: DebateTurn[] = [],
	discussionPoints: DebateState['discussionPoints'] = []
): DebateState => ({
	turns: [...turns],
	lastSpeakerId: undefined,
	silenceMap: new Map(),
	speakCount: new Map(),
	queuedIntents: new Map(),
	discussionPoints
});

describe('shouldEvaluateIntervention', () => {
	it('クールダウン経過で true（毎ターン評価が原則）', () => {
		expect(shouldEvaluateIntervention(2, 2)).toBe(true);
	});

	it('クールダウン未満（ペルソナ発言1 < 2）はスキップ（false）', () => {
		expect(shouldEvaluateIntervention(1, 2)).toBe(false);
	});

	it('クールダウン超過（3 >= 2）で true', () => {
		expect(shouldEvaluateIntervention(3, 2)).toBe(true);
	});

	it('ファシリテーター発言直後（0ターン）は false', () => {
		expect(shouldEvaluateIntervention(0, 2)).toBe(false);
	});
});

describe('countPersonaTurnsSinceFacilitator', () => {
	it('ファシリテーターターンが存在しない場合は全ペルソナターン数を返す', () => {
		const history = [makeTurn('persona', 't1'), makeTurn('persona', 't2')];
		expect(countPersonaTurnsSinceFacilitator(history)).toBe(2);
	});

	it('末尾がファシリテーターターンの場合は 0 を返す', () => {
		const history = [makeTurn('persona', 't1'), makeTurn('facilitator', 't2')];
		expect(countPersonaTurnsSinceFacilitator(history)).toBe(0);
	});

	it('複数のファシリテーターターンがある場合は最後のもの以降のペルソナターン数を返す', () => {
		const history = [
			makeTurn('persona', 't1'),
			makeTurn('facilitator', 't2'),
			makeTurn('persona', 't3'),
			makeTurn('persona', 't4'),
			makeTurn('facilitator', 't5'),
			makeTurn('persona', 't6')
		];
		expect(countPersonaTurnsSinceFacilitator(history)).toBe(1);
	});

	it('空の履歴の場合は 0 を返す', () => {
		expect(countPersonaTurnsSinceFacilitator([])).toBe(0);
	});
});

describe('countConsecutivePersonaTargets', () => {
	it('空の履歴の場合は 0 を返す', () => {
		expect(countConsecutivePersonaTargets([])).toBe(0);
	});

	it('末尾がファシリテーター発言の場合は 0 を返す', () => {
		const turns = [makePersonaTargetTurn('t1'), makeTurn('facilitator', 't2')];
		expect(countConsecutivePersonaTargets(turns)).toBe(0);
	});

	it('末尾が指名なしペルソナ発言の場合は 0 を返す', () => {
		const turns = [makePersonaTargetTurn('t1'), makeTurn('persona', 't2')];
		expect(countConsecutivePersonaTargets(turns)).toBe(0);
	});

	it('末尾が targetedBy=facilitator の指名の場合は 0 を返す', () => {
		const turns = [makePersonaTargetTurn('t1'), makeFacilitatorTargetTurn('t2')];
		expect(countConsecutivePersonaTargets(turns)).toBe(0);
	});

	it('連続するペルソナ間指名が N 件続く場合は N を返す', () => {
		const turns = [
			makePersonaTargetTurn('t1'),
			makePersonaTargetTurn('t2'),
			makePersonaTargetTurn('t3')
		];
		expect(countConsecutivePersonaTargets(turns)).toBe(3);
	});

	it('途中の指名なしペルソナ発言で打ち切る（それ以降のみカウント）', () => {
		const turns = [
			makePersonaTargetTurn('t1'),
			makeTurn('persona', 't2'),
			makePersonaTargetTurn('t3'),
			makePersonaTargetTurn('t4')
		];
		expect(countConsecutivePersonaTargets(turns)).toBe(2);
	});

	it('途中のファシリテーター発言で打ち切る', () => {
		const turns = [
			makePersonaTargetTurn('t1'),
			makeFacilitatorTargetTurn('t2'),
			makePersonaTargetTurn('t3')
		];
		expect(countConsecutivePersonaTargets(turns)).toBe(1);
	});

	it('targetPersonaId のないペルソナ指名（targetedBy のみ）は打ち切る', () => {
		const turns = [
			makePersonaTargetTurn('t1'),
			{
				id: 't2',
				speakerType: 'persona',
				content: 'x',
				createdAt: '',
				targetedBy: 'persona'
			} as DebateTurn
		];
		expect(countConsecutivePersonaTargets(turns)).toBe(0);
	});
});

describe('persistInterventionTurn', () => {
	beforeEach(() => {
		mockUpdate.mockClear();
	});

	it('targetPersonaId がある場合は targeted_by_facilitator の SpeakerSelection を返す', async () => {
		const state = makeState();
		const result = await persistInterventionTurn({
			topicId: 'topic1',
			state,
			content: '介入メッセージ',
			targetPersonaId: 'p1',
			chapterId: 'ch-0'
		});
		expect(result).toEqual({ personaId: 'p1', reason: 'targeted_by_facilitator' });
	});

	it('targetPersonaId がない場合は undefined を返す', async () => {
		const state = makeState();
		const result = await persistInterventionTurn({
			topicId: 'topic1',
			state,
			content: '介入メッセージ',
			targetPersonaId: undefined,
			chapterId: 'ch-0'
		});
		expect(result).toBeUndefined();
	});

	it('targetPersonaId の有無にかかわらず state.turns に1件追加される', async () => {
		const state = makeState();
		await persistInterventionTurn({
			topicId: 'topic1',
			state,
			content: '介入A',
			targetPersonaId: 'p1',
			chapterId: 'ch-0'
		});
		expect(state.turns).toHaveLength(1);
		await persistInterventionTurn({
			topicId: 'topic1',
			state,
			content: '介入B',
			targetPersonaId: undefined,
			chapterId: 'ch-0'
		});
		expect(state.turns).toHaveLength(2);
	});

	it('追加されたターンの speakerType は facilitator である', async () => {
		const state = makeState();
		await persistInterventionTurn({
			topicId: 'topic1',
			state,
			content: '介入メッセージ',
			targetPersonaId: 'p1',
			chapterId: 'ch-0'
		});
		expect(state.turns[0].speakerType).toBe('facilitator');
	});

	it('呼び出し後に state.lastSpeakerId が undefined になる', async () => {
		const state = makeState();
		state.lastSpeakerId = 'p1';
		await persistInterventionTurn({
			topicId: 'topic1',
			state,
			content: '介入',
			targetPersonaId: 'p2',
			chapterId: 'ch-0'
		});
		expect(state.lastSpeakerId).toBeUndefined();
	});

	it('state.turns に push されるターンに speakerName/speakerRole が含まれない', async () => {
		const state = makeState();
		await persistInterventionTurn({
			topicId: 'topic1',
			state,
			content: '介入',
			targetPersonaId: 'p1',
			chapterId: 'ch-0'
		});
		const pushedTurn = state.turns[0] as Record<string, unknown>;
		expect(pushedTurn.speakerName).toBeUndefined();
		expect(pushedTurn.speakerRole).toBeUndefined();
	});

	it('addTurn が rejected を返した場合は undefined を返し state.turns に追加しない', async () => {
		mockAddTurnFn.mockResolvedValueOnce({ status: 'rejected', reason: 'index_mismatch' });
		const state = makeState();
		const result = await persistInterventionTurn({
			topicId: 'topic1',
			state,
			content: '介入メッセージ',
			targetPersonaId: 'p1',
			chapterId: 'ch-0'
		});
		expect(result).toBeUndefined();
		expect(state.turns).toHaveLength(0);
	});
});

// --- tryIntervention 論点伝播テスト ---
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
	validPersonaId: vi.fn((_id: string | undefined, _personas: unknown[]) => _id)
}));

import type { Engagement } from '../../../types/debate.types.js';
import type { Persona } from '../../../types/persona.types.js';
import type { Chapter } from '../../../types/chapter.types.js';

const mockPersonas: Persona[] = [{ id: 'p1', name: 'テスト' } as Persona];
const mockChapter: Chapter = { id: 'ch1', title: '章', discussionPoints: [] };
const mockEngagements: Engagement[] = [];

describe('tryIntervention - 論点ステータスのマーク', () => {
	let evaluateTopicDrift: ReturnType<typeof vi.fn>;
	let evaluateStallIntervention: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		const mod = await import('../../../agents/facilitator-agent.js');
		evaluateTopicDrift = vi.mocked(mod.evaluateTopicDrift);
		evaluateStallIntervention = vi.mocked(mod.evaluateStallIntervention);
	});

	it('介入が selectedDiscussionPointIndex を返した場合、state.discussionPoints を introduced にマークする', async () => {
		evaluateTopicDrift.mockResolvedValueOnce({
			ok: true,
			value: { content: '論点投入', targetPersonaId: 'p1', selectedDiscussionPointIndex: 0 }
		});

		const state = makeState(
			[makeTurn('facilitator', 'f1'), makeTurn('persona', 'p1'), makeTurn('persona', 'p2')],
			[
				{ point: '論点A', status: 'untouched' },
				{ point: '論点B', status: 'untouched' }
			]
		);

		const { tryIntervention: tryIntervention_ } =
			await import('../../../pipeline/debate/intervention.js');
		await tryIntervention_({
			topicId: 'topic1',
			personas: mockPersonas,
			chapter: mockChapter,
			state,
			engagements: mockEngagements,
			interventionCooldown: 2,
			trigger: { kind: 'no-target' }
		});

		expect(state.discussionPoints[0].status).toBe('introduced');
		expect(state.discussionPoints[1].status).toBe('untouched');
	});

	it('selectedDiscussionPointIndex が範囲外の場合はマークしない', async () => {
		evaluateTopicDrift.mockResolvedValueOnce({
			ok: true,
			value: { content: '論点投入', targetPersonaId: 'p1', selectedDiscussionPointIndex: 99 }
		});

		const unaddressedPoints = [{ point: '論点A', status: 'untouched' as const }];
		const state = makeState(
			[makeTurn('facilitator', 'f1'), makeTurn('persona', 'p1'), makeTurn('persona', 'p2')],
			[...unaddressedPoints]
		);

		const { tryIntervention: tryIntervention_ } =
			await import('../../../pipeline/debate/intervention.js');
		await tryIntervention_({
			topicId: 'topic1',
			personas: mockPersonas,
			chapter: mockChapter,
			state,
			engagements: mockEngagements,
			interventionCooldown: 2,
			trigger: { kind: 'no-target' }
		});

		expect(state.discussionPoints[0].status).toBe('untouched');
	});

	it('selectedDiscussionPointIndex が undefined の場合はマークしない', async () => {
		evaluateTopicDrift.mockResolvedValueOnce({
			ok: true,
			value: { content: '引き戻し', targetPersonaId: 'p1' }
		});

		const state = makeState(
			[makeTurn('facilitator', 'f1'), makeTurn('persona', 'p1'), makeTurn('persona', 'p2')],
			[{ point: '論点A', status: 'untouched' }]
		);

		const { tryIntervention: tryIntervention_ } =
			await import('../../../pipeline/debate/intervention.js');
		await tryIntervention_({
			topicId: 'topic1',
			personas: mockPersonas,
			chapter: mockChapter,
			state,
			engagements: mockEngagements,
			interventionCooldown: 2,
			trigger: { kind: 'no-target' }
		});

		expect(state.discussionPoints[0].status).toBe('untouched');
	});

	it('未提示論点（untouched）のみを介入関数に渡し、提示済み論点は候補から除外する', async () => {
		evaluateTopicDrift.mockResolvedValueOnce({
			ok: true,
			value: {}
		});
		evaluateStallIntervention.mockResolvedValueOnce({
			ok: true,
			value: {}
		});

		const state = makeState(
			[makeTurn('facilitator', 'f1'), makeTurn('persona', 'p1'), makeTurn('persona', 'p2')],
			[
				{ point: '論点A', status: 'untouched' },
				{ point: '論点B', status: 'addressed' },
				{ point: '論点C', status: 'introduced' }
			]
		);

		const { tryIntervention: tryIntervention_ } =
			await import('../../../pipeline/debate/intervention.js');
		await tryIntervention_({
			topicId: 'topic1',
			personas: mockPersonas,
			chapter: mockChapter,
			state,
			engagements: mockEngagements,
			interventionCooldown: 2,
			trigger: { kind: 'no-target' }
		});

		// 5番目に activeFocus（introduced の論点C）、6番目に untouched 候補リスト、7番目に options
		expect(evaluateTopicDrift).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			'論点C',
			['論点A'],
			undefined
		);
	});

	it('介入投入論点が markIntroduced 経由で introducedOrder を採番される', async () => {
		evaluateTopicDrift.mockResolvedValueOnce({
			ok: true,
			value: { content: '論点投入', targetPersonaId: 'p1', selectedDiscussionPointIndex: 0 }
		});

		const state = makeState(
			[makeTurn('facilitator', 'f1'), makeTurn('persona', 'p1'), makeTurn('persona', 'p2')],
			[
				{ point: '論点A', status: 'introduced', introducedOrder: 1 },
				{ point: '論点B', status: 'untouched' }
			]
		);

		const { tryIntervention: tryIntervention_ } =
			await import('../../../pipeline/debate/intervention.js');
		await tryIntervention_({
			topicId: 'topic1',
			personas: mockPersonas,
			chapter: mockChapter,
			state,
			engagements: mockEngagements,
			interventionCooldown: 2,
			trigger: { kind: 'no-target' }
		});

		// untouched 候補 [論点B] の index 0 が introduced 化し、最新の introducedOrder を持つ
		expect(state.discussionPoints[1].status).toBe('introduced');
		expect(state.discussionPoints[1].introducedOrder).toBe(2);
	});
});

describe('tryIntervention - トリガー分岐', () => {
	let evaluateTopicDrift: ReturnType<typeof vi.fn>;
	let evaluateStallIntervention: ReturnType<typeof vi.fn>;
	let hasHighEngagement: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		const facMod = await import('../../../agents/facilitator-agent.js');
		evaluateTopicDrift = vi.mocked(facMod.evaluateTopicDrift);
		evaluateStallIntervention = vi.mocked(facMod.evaluateStallIntervention);
		const speakerMod = await import('../../../pipeline/debate/speaker-selection.js');
		hasHighEngagement = vi.mocked(speakerMod.hasHighEngagement);
		hasHighEngagement.mockReturnValue(false);
	});

	const cooldownReadyState = () =>
		makeState(
			[makeTurn('facilitator', 'f1'), makeTurn('persona', 'p1'), makeTurn('persona', 'p2')],
			[{ point: '論点A', status: 'untouched' }]
		);

	it('no-target: drift が見送りなら stall も評価する', async () => {
		evaluateTopicDrift.mockResolvedValueOnce({ ok: true, value: {} });
		evaluateStallIntervention.mockResolvedValueOnce({ ok: true, value: {} });

		const { tryIntervention: tryIntervention_ } =
			await import('../../../pipeline/debate/intervention.js');
		await tryIntervention_({
			topicId: 'topic1',
			personas: mockPersonas,
			chapter: mockChapter,
			state: cooldownReadyState(),
			engagements: mockEngagements,
			interventionCooldown: 2,
			trigger: { kind: 'no-target' }
		});

		expect(evaluateTopicDrift).toHaveBeenCalledTimes(1);
		expect(evaluateStallIntervention).toHaveBeenCalledTimes(1);
	});

	it('no-target: hasHighEngagement のとき drift に未完了論点を渡さない（undefined）', async () => {
		hasHighEngagement.mockReturnValue(true);
		evaluateTopicDrift.mockResolvedValueOnce({ ok: true, value: {} });
		evaluateStallIntervention.mockResolvedValueOnce({ ok: true, value: {} });

		const { tryIntervention: tryIntervention_ } =
			await import('../../../pipeline/debate/intervention.js');
		await tryIntervention_({
			topicId: 'topic1',
			personas: mockPersonas,
			chapter: mockChapter,
			state: cooldownReadyState(),
			engagements: mockEngagements,
			interventionCooldown: 2,
			trigger: { kind: 'no-target' }
		});

		// activeFocus は introduced 不在のため章タイトル '章'、untouched 候補は空化され undefined
		expect(evaluateTopicDrift).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			'章',
			undefined,
			undefined
		);
	});

	it('persona-chain: stall は評価せず drift のみ評価する', async () => {
		evaluateTopicDrift.mockResolvedValueOnce({ ok: true, value: {} });

		const { tryIntervention: tryIntervention_ } =
			await import('../../../pipeline/debate/intervention.js');
		await tryIntervention_({
			topicId: 'topic1',
			personas: mockPersonas,
			chapter: mockChapter,
			state: cooldownReadyState(),
			engagements: mockEngagements,
			interventionCooldown: 2,
			trigger: { kind: 'persona-chain', chainLength: 4 }
		});

		expect(evaluateTopicDrift).toHaveBeenCalledTimes(1);
		expect(evaluateStallIntervention).not.toHaveBeenCalled();
	});

	it('persona-chain: hasHighEngagement でも未完了論点を空化せず渡し、chainLength も渡す', async () => {
		hasHighEngagement.mockReturnValue(true);
		evaluateTopicDrift.mockResolvedValueOnce({ ok: true, value: {} });

		const { tryIntervention: tryIntervention_ } =
			await import('../../../pipeline/debate/intervention.js');
		await tryIntervention_({
			topicId: 'topic1',
			personas: mockPersonas,
			chapter: mockChapter,
			state: cooldownReadyState(),
			engagements: mockEngagements,
			interventionCooldown: 2,
			trigger: { kind: 'persona-chain', chainLength: 4 }
		});

		// activeFocus は introduced 不在のため章タイトル '章'、untouched 候補 ['論点A']、options に chainLength
		expect(evaluateTopicDrift).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			'章',
			['論点A'],
			{ chainLength: 4 }
		);
	});

	it('クールダウン未達は drift も stall も評価しない', async () => {
		const state = makeState(
			[makeTurn('facilitator', 'f1'), makeTurn('persona', 'p1')],
			[{ point: '論点A', status: 'untouched' }]
		);

		const { tryIntervention: tryIntervention_ } =
			await import('../../../pipeline/debate/intervention.js');
		const fired = await tryIntervention_({
			topicId: 'topic1',
			personas: mockPersonas,
			chapter: mockChapter,
			state,
			engagements: mockEngagements,
			interventionCooldown: 2,
			trigger: { kind: 'persona-chain', chainLength: 4 }
		});

		expect(fired).toBe(false);
		expect(evaluateTopicDrift).not.toHaveBeenCalled();
		expect(evaluateStallIntervention).not.toHaveBeenCalled();
	});
});
