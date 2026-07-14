/**
 * discussion-point-consolidation の結合・回帰検証（タスク6）。
 * - 章開始 → オープニングが先頭論点を introduced 化 → 後続の文脈解決でアクティブ論点が入る。
 * - 介入で未提示論点を投入 → それが新しいアクティブ論点になり、次の drift 評価の基準（activeFocus）が更新される。
 * - introducedOrder 未採番（移行期データ）でも getActiveAgendaItem がエラーにならない。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DebateState } from '../../../types/debate.types.js';
import type { DebateTurn } from '../../../types/turn.types.js';
import type { Persona } from '../../../types/persona.types.js';
import type { Chapter } from '../../../types/chapter.types.js';

const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockTxGet = vi.fn(async () => ({ data: () => undefined }));
const mockTxUpdate = vi.fn();
const mockRunTransaction = vi.fn(
	async (fn: (tx: { get: typeof mockTxGet; update: typeof mockTxUpdate }) => Promise<unknown>) =>
		fn({ get: mockTxGet, update: mockTxUpdate })
);
const mockDoc = vi.fn().mockReturnValue({ update: mockUpdate });

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc, runTransaction: mockRunTransaction })),
	Timestamp: { now: vi.fn(() => ({ toDate: () => new Date() })) },
	FieldValue: { arrayUnion: vi.fn((...args: unknown[]) => args), delete: vi.fn(() => 'DELETE') }
}));

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
vi.mock('../../../pipeline/debate/utils.js', () => ({
	pipelineErrorMessage: vi.fn((e: { message: string }) => e.message),
	validPersonaId: vi.fn((id: string | undefined) => id)
}));

import {
	getActiveAgendaItem,
	markIntroduced,
	initAgendaItems
} from '../../../pipeline/debate/agenda.js';

const mockPersonas: Persona[] = [{ id: 'p1', name: 'テスト' } as Persona];
const mockChapter: Chapter = { id: 'ch1', title: '章', agenda: ['A', 'B', 'C'] };

const makeTurn = (speakerType: 'persona' | 'facilitator', id: string): DebateTurn => ({
	id,
	speakerType,
	content: 'test',
	createdAt: ''
});

const makeState = (
	turns: DebateTurn[],
	agenda: DebateState['agenda']
): DebateState =>
	({
		turns: [...turns],
		lastSpeakerId: undefined,
		silenceMap: new Map(),
		speakCount: new Map(),
		queuedIntents: new Map(),
		agenda
	}) as DebateState;

describe('結合: 章開始 → オープニングが先頭論点を提示 → 後続文脈にアクティブ論点が入る', () => {
	it('オープニングの markIntroduced(0) で先頭論点が introduced 化し getActiveAgendaItem が返す', () => {
		const chapter: Chapter = { id: 'ch1', title: '章', agenda: ['先頭論点', '次の論点'] };
		const state = makeState([], initAgendaItems(chapter));

		// 章開始時、全論点は untouched
		expect(getActiveAgendaItem(state)).toBeUndefined();

		// オープニングは untouched 候補リストの index=0 を提示する
		markIntroduced(state, 0);

		// 後続ターン（turn.ts）が参照するアクティブ論点が先頭論点になる
		expect(getActiveAgendaItem(state)).toBe('先頭論点');
		expect(state.agenda[0].status).toBe('introduced');
		expect(state.agenda[0].introducedOrder).toBe(1);
	});

	it('論点を持たない章では章開始後もアクティブ論点は不在（呼び出し側が title へフォールバック）', () => {
		const chapter: Chapter = { id: 'ch1', title: 'タイトルのみ章', agenda: [] };
		const state = makeState([], initAgendaItems(chapter));
		markIntroduced(state, undefined);
		expect(getActiveAgendaItem(state)).toBeUndefined();
	});
});

describe('結合: 介入で未提示論点を投入 → 新しいアクティブ論点になり判定基準が更新される', () => {
	let assessActiveAgendaItem: ReturnType<typeof vi.fn>;
	let generateInterventionUtterance: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		const mod = await import('../../../agents/facilitator-agent.js');
		assessActiveAgendaItem = vi.mocked(mod.assessActiveAgendaItem);
		generateInterventionUtterance = vi.mocked(mod.generateInterventionUtterance);
	});

	const cooldownReadyTurns = [
		makeTurn('facilitator', 'f1'),
		makeTurn('persona', 'p1'),
		makeTurn('persona', 'p2')
	];

	it('投入された未提示論点が introduced 化し getActiveAgendaItem が返す', async () => {
		assessActiveAgendaItem.mockResolvedValueOnce({ ok: true, value: { verdict: 'exhausted' } });
		generateInterventionUtterance.mockResolvedValueOnce({
			ok: true,
			value: { content: '次の論点を投入', targetPersonaId: 'p1', selectedAgendaItemIndex: 0 }
		});

		// A は提示済み、B/C は未提示。untouched 候補は [B, C]
		const state = makeState(cooldownReadyTurns, [
			{ point: 'A', status: 'introduced', introducedOrder: 1 },
			{ point: 'B', status: 'untouched' },
			{ point: 'C', status: 'untouched' }
		]);

		const { progressAgenda } = await import('../../../pipeline/debate/intervention.js');
		await progressAgenda({
			topicId: 'topic1',
			personas: mockPersonas,
			chapter: mockChapter,
			chapterId: 'ch1',
			state,
			engagements: [],
			interventionCooldown: 2
		});

		// 投入論点 B が introduced になり、最新のアクティブ論点として解決される（前進元 A は addressed）
		expect(state.agenda[1].status).toBe('introduced');
		expect(state.agenda[0].status).toBe('addressed');
		expect(getActiveAgendaItem(state)).toBe('B');
		// introduce 行動には untouched 候補 [B, C] が渡る
		expect(generateInterventionUtterance).toHaveBeenCalledWith(
			{ kind: 'introduce', untouchedAgendaItems: ['B', 'C'] },
			expect.anything(),
			expect.anything(),
			expect.anything()
		);
	});

	it('最新の introduced 論点が次の判定に activeFocus として渡る', async () => {
		// 引き戻し（論点投入なし）で発火させる
		assessActiveAgendaItem.mockResolvedValueOnce({ ok: true, value: { verdict: 'drifted' } });
		generateInterventionUtterance.mockResolvedValueOnce({
			ok: true,
			value: { content: 'B に引き戻す', targetPersonaId: 'p1' }
		});

		// B が最後に投入された論点（order 2）→ アクティブ論点は B
		const state = makeState(cooldownReadyTurns, [
			{ point: 'A', status: 'introduced', introducedOrder: 1 },
			{ point: 'B', status: 'introduced', introducedOrder: 2 },
			{ point: 'C', status: 'untouched' }
		]);

		const { progressAgenda } = await import('../../../pipeline/debate/intervention.js');
		await progressAgenda({
			topicId: 'topic1',
			personas: mockPersonas,
			chapter: mockChapter,
			chapterId: 'ch1',
			state,
			engagements: [],
			interventionCooldown: 2
		});

		// 判定の判断軸（第1引数 activeAgendaItem）が新しいアクティブ論点 B に更新されている
		expect(assessActiveAgendaItem).toHaveBeenCalledWith('B', expect.anything(), expect.anything());
		// 引き戻し行動も active=B を対象にする
		expect(generateInterventionUtterance).toHaveBeenCalledWith(
			{ kind: 'pull-back', activeAgendaItem: 'B' },
			expect.anything(),
			expect.anything(),
			expect.anything()
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
		expect(() => getActiveAgendaItem(state)).not.toThrow();
		expect(getActiveAgendaItem(state)).toBeDefined();
	});
});
