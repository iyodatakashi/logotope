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
	persistInterventionTurn
} from '../../../pipeline/debate/intervention.js';

const makeTurn = (speakerType: 'persona' | 'facilitator', id: string): DebateTurn => ({
	id,
	speakerType,
	content: 'test',
	createdAt: ''
});

const makeState = (
	turns: DebateTurn[] = [],
	agenda: DebateState['agenda'] = []
): DebateState => ({
	turns: [...turns],
	lastSpeakerId: undefined,
	silenceMap: new Map(),
	speakCount: new Map(),
	queuedIntents: new Map(),
	agenda
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

	it('追加する介入ターンに status=evaluating を付与する（末尾評価の対象・1.6）', async () => {
		const state = makeState();
		await persistInterventionTurn({
			topicId: 'topic1',
			state,
			content: '介入メッセージ',
			targetPersonaId: 'p1',
			chapterId: 'ch-0'
		});
		const addTurnArg = mockAddTurnFn.mock.calls[0][0] as { turn: { status?: string } };
		expect(addTurnArg.turn.status).toBe('evaluating');
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

// --- progressAgenda 判定→消化→行動テスト ---
vi.mock('../../../agents/facilitator-agent.js', () => ({
	assessActiveAgendaItem: vi.fn(),
	generateInterventionUtterance: vi.fn()
}));
vi.mock('../../../pipeline/debate/queued-intents.js', () => ({
	addQueuedIntents: vi.fn().mockResolvedValue(undefined)
}));
const mockAddTurnFn = vi.fn().mockResolvedValue({ status: 'committed', id: 'turn-new' });
vi.mock('../../../pipeline/debate/turn.js', () => ({
	addTurn: (...args: unknown[]) => mockAddTurnFn(...args)
}));
vi.mock('../../../pipeline/debate/pending-turn.js', () => ({
	setPendingTurn: vi.fn().mockResolvedValue(undefined),
	clearPendingTurn: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../../../pipeline/debate/utils.js', () => ({
	pipelineErrorMessage: vi.fn((e: { message: string }) => e.message),
	validPersonaId: vi.fn((_id: string | undefined, _personas: unknown[]) => _id)
}));

import type { Engagement } from '../../../types/debate.types.js';
import type { Persona } from '../../../types/persona.types.js';
import type { Chapter } from '../../../types/chapter.types.js';

const mockPersonas: Persona[] = [{ id: 'p1', name: 'テスト' } as Persona];
const mockChapter: Chapter = { id: 'ch1', title: '章', agenda: [] };
const mockEngagements: Engagement[] = [];

/** クールダウン充足の基本 state（facilitator + persona×2 で cooldown 2 を満たす） */
const cooldownReady = (agenda: DebateState['agenda']): DebateState =>
	makeState(
		[makeTurn('facilitator', 'f1'), makeTurn('persona', 'p1'), makeTurn('persona', 'p2')],
		agenda
	);

describe('progressAgenda - クールダウン→3値判定→行動', () => {
	let assessActiveAgendaItem: ReturnType<typeof vi.fn>;
	let generateInterventionUtterance: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		const facMod = await import('../../../agents/facilitator-agent.js');
		assessActiveAgendaItem = vi.mocked(facMod.assessActiveAgendaItem);
		generateInterventionUtterance = vi.mocked(facMod.generateInterventionUtterance);
	});

	const assess = (verdict: 'exhausted' | 'drifted' | 'ongoing') =>
		assessActiveAgendaItem.mockResolvedValueOnce({ ok: true, value: { verdict } });
	const utter = (value: Record<string, unknown>) =>
		generateInterventionUtterance.mockResolvedValueOnce({ ok: true, value });

	const run = async (
		state: DebateState,
		personas = mockPersonas,
		engagements = mockEngagements
	) => {
		const { progressAgenda } = await import('../../../pipeline/debate/intervention.js');
		return progressAgenda({
			topicId: 'topic1',
			personas,
			chapter: mockChapter,
			chapterId: 'ch1',
			state,
			engagements,
			interventionCooldown: 2,
			chapterTurns: state.turns
		});
	};

	it('exhausted + 未提示あり: 前進元を addressed、次項目を introduced、発言を永続し intervened', async () => {
		assess('exhausted');
		utter({ content: '論点投入', targetPersonaId: 'p1', selectedAgendaItemIndex: 0 });

		const state = cooldownReady([
			{ point: '論点A', status: 'untouched' },
			{ point: '論点C', status: 'introduced', introducedOrder: 1 }
		]);
		const fired = await run(state);

		expect(fired).toBe('intervened');
		// 前進元（active=論点C）が addressed、未提示の論点A が introduced
		expect(state.agenda[1].status).toBe('addressed');
		expect(state.agenda[0].status).toBe('introduced');
		// introduce 行動に untouched 候補リストが渡る
		expect(generateInterventionUtterance).toHaveBeenCalledWith(
			{ kind: 'introduce', untouchedAgendaItems: ['論点A'] },
			expect.anything(),
			expect.anything(),
			expect.anything()
		);
	});

	it('介入発言の生成中は facilitator pendingTurn（personaId なし・generating）を書きスケルトンを出す', async () => {
		assess('drifted');
		utter({ content: '本題に戻しましょう', targetPersonaId: 'p1' });

		const state = cooldownReady([{ point: '論点A', status: 'introduced', introducedOrder: 1 }]);
		await run(state);

		const { setPendingTurn, clearPendingTurn } = await import(
			'../../../pipeline/debate/pending-turn.js'
		);
		expect(vi.mocked(setPendingTurn)).toHaveBeenCalledTimes(1);
		const pending = vi.mocked(setPendingTurn).mock.calls[0][0].pendingTurn;
		expect(pending.personaId).toBeUndefined();
		expect(pending.status).toBe('generating');
		expect(vi.mocked(clearPendingTurn)).toHaveBeenCalledWith(
			expect.objectContaining({ id: pending.id })
		);
	});

	it('exhausted は高意欲な参加者が残っても前進する（立場カバレッジ・意欲に依存しない）', async () => {
		assess('exhausted');
		utter({ content: '論点投入', targetPersonaId: 'p1', selectedAgendaItemIndex: 0 });

		// score 5 の高意欲参加者が残る状態でも exhausted なら前進する
		const highEngagements: Engagement[] = [{ personaId: 'p1', score: 5, mode: 'opinion' }];
		const state = cooldownReady([
			{ point: '論点A', status: 'untouched' },
			{ point: '論点C', status: 'introduced', introducedOrder: 1 }
		]);
		const fired = await run(state, mockPersonas, highEngagements);

		expect(fired).toBe('intervened');
		expect(state.agenda[1].status).toBe('addressed'); // 前進元が消化される
		expect(state.agenda[0].status).toBe('introduced'); // 次論点が投入される
	});

	it('exhausted + 最後の項目（未提示なし）: 発言を生成せず active を addressed のみ・chapter-exhausted', async () => {
		assess('exhausted');

		const state = cooldownReady([{ point: '論点C', status: 'introduced', introducedOrder: 1 }]);
		const fired = await run(state);

		expect(fired).toBe('chapter-exhausted');
		expect(state.agenda[0].status).toBe('addressed');
		// 発言（行動）は生成しない
		expect(generateInterventionUtterance).not.toHaveBeenCalled();
		// addressed の永続書き込みが走る
		expect(mockUpdate).toHaveBeenCalled();
	});

	it('drifted: 引き戻し発言を永続し intervened、addressed は付けない', async () => {
		assess('drifted');
		utter({ content: '本題に戻しましょう', targetPersonaId: 'p1' });

		const state = cooldownReady([
			{ point: '論点A', status: 'untouched' },
			{ point: '論点C', status: 'introduced', introducedOrder: 1 }
		]);
		const fired = await run(state);

		expect(fired).toBe('intervened');
		expect(state.agenda[1].status).toBe('introduced'); // 消化しない
		expect(state.agenda[0].status).toBe('untouched'); // 前進しない
		expect(generateInterventionUtterance).toHaveBeenCalledWith(
			{ kind: 'pull-back', activeAgendaItem: '論点C' },
			expect.anything(),
			expect.anything(),
			expect.anything()
		);
	});

	it('drifted: 引き戻しの指名先が有効な参加者IDでなければ採用せず none', async () => {
		assess('drifted');
		utter({ content: '本題に戻しましょう', targetPersonaId: undefined }); // 無効な指名先

		const state = cooldownReady([{ point: '論点C', status: 'introduced', introducedOrder: 1 }]);
		const fired = await run(state);

		expect(fired).toBe('none');
		expect(state.agenda[0].status).toBe('introduced'); // 状態不変
	});

	it('ongoing: 介入せず none、状態変更・永続が発生しない', async () => {
		assess('ongoing');

		const state = cooldownReady([{ point: '論点C', status: 'introduced', introducedOrder: 1 }]);
		const fired = await run(state);

		expect(fired).toBe('none');
		expect(state.agenda[0].status).toBe('introduced');
		expect(generateInterventionUtterance).not.toHaveBeenCalled();
		// 論点ステータスの永続書き込みは発生しない
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it('クールダウン未達: 判定も行動も呼ばず none', async () => {
		const state = makeState(
			[makeTurn('facilitator', 'f1'), makeTurn('persona', 'p1')],
			[{ point: '論点C', status: 'introduced', introducedOrder: 1 }]
		);
		const fired = await run(state);

		expect(fired).toBe('none');
		expect(assessActiveAgendaItem).not.toHaveBeenCalled();
		expect(generateInterventionUtterance).not.toHaveBeenCalled();
	});

	it('アクティブ論点が無い（introduced 不在）ときは判断軸に章タイトルを使い前進を許す', async () => {
		assess('exhausted');
		utter({ content: '論点投入', targetPersonaId: 'p1', selectedAgendaItemIndex: 0 });

		const state = makeState(
			[makeTurn('facilitator', 'f1'), makeTurn('persona', 'p1'), makeTurn('persona', 'p2')],
			[{ point: '論点A', status: 'untouched' }]
		);
		const fired = await run(state);

		expect(fired).toBe('intervened');
		// 判定は章タイトルを判断軸にする
		expect(assessActiveAgendaItem).toHaveBeenCalledWith('章', expect.anything(), expect.anything());
		expect(state.agenda[0].status).toBe('introduced');
	});
});
