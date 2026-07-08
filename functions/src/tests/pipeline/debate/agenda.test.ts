import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdate = vi.fn();
const mockDoc = vi.fn(() => ({ update: mockUpdate }));
vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc })),
	FieldValue: { delete: vi.fn(() => 'DELETE') }
}));

import {
	markIntroduced,
	getActiveAgendaItem,
	recordSpeakerOnActiveAgendaItem,
	getUnheardRelevant,
	saveAgendaItemStatuses
} from '../../../pipeline/debate/agenda.js';
import type { DebateState } from '../../../types/debate.types.js';
import type { AgendaItemState } from '../../../types/chapter.types.js';

const makeState = (points: AgendaItemState[]): DebateState =>
	({ agenda: points }) as DebateState;

describe('getActiveAgendaItem', () => {
	it('提示済み論点が複数あるとき提示連番が最大の1件を返す', () => {
		const state = makeState([
			{ point: '論点A', status: 'introduced', introducedOrder: 1 },
			{ point: '論点B', status: 'introduced', introducedOrder: 3 },
			{ point: '論点C', status: 'introduced', introducedOrder: 2 }
		]);

		expect(getActiveAgendaItem(state)).toBe('論点B');
	});

	it('提示済みが無いとき undefined を返す', () => {
		const state = makeState([
			{ point: '論点A', status: 'untouched' },
			{ point: '論点B', status: 'addressed' }
		]);

		expect(getActiveAgendaItem(state)).toBeUndefined();
	});

	it('addressed は除外し introduced のみを対象とする', () => {
		const state = makeState([
			{ point: '論点A', status: 'addressed', introducedOrder: 5 },
			{ point: '論点B', status: 'introduced', introducedOrder: 2 }
		]);

		expect(getActiveAgendaItem(state)).toBe('論点B');
	});
});

describe('markIntroduced', () => {
	it('提示した論点を introduced にし introducedOrder を採番する', () => {
		const state = makeState([
			{ point: '論点A', status: 'untouched' },
			{ point: '論点B', status: 'untouched' }
		]);

		markIntroduced(state, 1);

		expect(state.agenda[1].status).toBe('introduced');
		expect(state.agenda[1].introducedOrder).toBe(1);
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

		const latest = state.agenda
			.filter((p) => p.status === 'introduced')
			.reduce((a, b) => ((b.introducedOrder ?? 0) > (a.introducedOrder ?? 0) ? b : a));
		expect(latest.point).toBe('論点C');
	});

	it('index が undefined のとき何もしない', () => {
		const state = makeState([{ point: '論点A', status: 'untouched' }]);
		markIntroduced(state, undefined);
		expect(state.agenda[0].status).toBe('untouched');
		expect(state.agenda[0].introducedOrder).toBeUndefined();
	});

	it('候補は未提示（untouched）のみで、提示済み論点は index 空間から除外する', () => {
		const state = makeState([
			{ point: '論点A', status: 'introduced', introducedOrder: 1 },
			{ point: '論点B', status: 'untouched' },
			{ point: '論点C', status: 'untouched' }
		]);

		// untouched のみの候補リスト [論点B, 論点C] の index 0 は 論点B を指す
		markIntroduced(state, 0);

		expect(state.agenda[1].status).toBe('introduced');
		expect(state.agenda[1].introducedOrder).toBe(2);
		// 既に introduced の論点A は再採番されない
		expect(state.agenda[0].introducedOrder).toBe(1);
		expect(state.agenda[2].status).toBe('untouched');
	});

	it('関連参加者を記録し、発言済み集合を空で初期化する', () => {
		const state = makeState([{ point: '論点A', status: 'untouched' }]);

		markIntroduced(state, 0, ['p1', 'p2']);

		expect(state.agenda[0].relevantPersonaIds).toEqual(['p1', 'p2']);
		expect(state.agenda[0].spokenPersonaIds).toEqual([]);
	});

	it('関連参加者が未指定でも発言済み集合は空で初期化する', () => {
		const state = makeState([{ point: '論点A', status: 'untouched' }]);

		markIntroduced(state, 0);

		expect(state.agenda[0].spokenPersonaIds).toEqual([]);
		expect(state.agenda[0].relevantPersonaIds).toEqual([]);
	});
});

describe('recordSpeakerOnActiveAgendaItem', () => {
	it('現アクティブ論点（最新 introduced）の発言済み集合に話者を追加する', () => {
		const state = makeState([
			{ point: '論点A', status: 'introduced', introducedOrder: 1, spokenPersonaIds: [] },
			{ point: '論点B', status: 'introduced', introducedOrder: 2, spokenPersonaIds: [] }
		]);

		recordSpeakerOnActiveAgendaItem(state, 'p1');

		expect(state.agenda[1].spokenPersonaIds).toEqual(['p1']);
		expect(state.agenda[0].spokenPersonaIds).toEqual([]);
	});

	it('同一話者を複数回記録しても重複しない（冪等）', () => {
		const state = makeState([
			{ point: '論点A', status: 'introduced', introducedOrder: 1, spokenPersonaIds: [] }
		]);

		recordSpeakerOnActiveAgendaItem(state, 'p1');
		recordSpeakerOnActiveAgendaItem(state, 'p1');

		expect(state.agenda[0].spokenPersonaIds).toEqual(['p1']);
	});

	it('発言済み集合が欠損していても追加できる', () => {
		const state = makeState([{ point: '論点A', status: 'introduced', introducedOrder: 1 }]);

		recordSpeakerOnActiveAgendaItem(state, 'p1');

		expect(state.agenda[0].spokenPersonaIds).toEqual(['p1']);
	});

	it('アクティブ論点が無いとき何もしない', () => {
		const state = makeState([{ point: '論点A', status: 'untouched' }]);

		recordSpeakerOnActiveAgendaItem(state, 'p1');

		expect(state.agenda[0].spokenPersonaIds).toBeUndefined();
	});
});

describe('getUnheardRelevant', () => {
	it('関連参加者 − 発言済み を返す', () => {
		const state = makeState([
			{
				point: '論点A',
				status: 'introduced',
				introducedOrder: 1,
				relevantPersonaIds: ['p1', 'p2', 'p3'],
				spokenPersonaIds: ['p1']
			}
		]);

		expect(getUnheardRelevant(state)).toEqual(['p2', 'p3']);
	});

	it('最新 introduced の論点を対象にする', () => {
		const state = makeState([
			{
				point: '論点A',
				status: 'introduced',
				introducedOrder: 1,
				relevantPersonaIds: ['p1'],
				spokenPersonaIds: []
			},
			{
				point: '論点B',
				status: 'introduced',
				introducedOrder: 2,
				relevantPersonaIds: ['p2', 'p3'],
				spokenPersonaIds: ['p2']
			}
		]);

		expect(getUnheardRelevant(state)).toEqual(['p3']);
	});

	it('全員発言済みなら空配列', () => {
		const state = makeState([
			{
				point: '論点A',
				status: 'introduced',
				introducedOrder: 1,
				relevantPersonaIds: ['p1', 'p2'],
				spokenPersonaIds: ['p1', 'p2']
			}
		]);

		expect(getUnheardRelevant(state)).toEqual([]);
	});

	it('関連参加者が空・欠損なら空配列', () => {
		const state = makeState([
			{ point: '論点A', status: 'introduced', introducedOrder: 1, spokenPersonaIds: ['p1'] }
		]);

		expect(getUnheardRelevant(state)).toEqual([]);
	});

	it('アクティブ論点が無いとき空配列', () => {
		const state = makeState([{ point: '論点A', status: 'untouched' }]);

		expect(getUnheardRelevant(state)).toEqual([]);
	});
});

describe('saveAgendaItemStatuses', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('2集合（発言済み・関連参加者）を含めて書き出す', async () => {
		const state = makeState([
			{
				point: '論点A',
				status: 'introduced',
				introducedOrder: 1,
				spokenPersonaIds: ['p1', 'p2'],
				relevantPersonaIds: ['p1', 'p2', 'p3']
			}
		]);

		await saveAgendaItemStatuses('t1', 'ch1', state);

		expect(mockUpdate).toHaveBeenCalledWith({
			agendaItemStatuses: [
				{
					point: '論点A',
					status: 'introduced',
					introducedOrder: 1,
					spokenPersonaIds: ['p1', 'p2'],
					relevantPersonaIds: ['p1', 'p2', 'p3']
				}
			]
		});
	});

	it('空集合も明示的に書き出す（introduced 時の空初期化を保持）', async () => {
		const state = makeState([
			{
				point: '論点A',
				status: 'introduced',
				introducedOrder: 1,
				spokenPersonaIds: [],
				relevantPersonaIds: ['p1']
			}
		]);

		await saveAgendaItemStatuses('t1', 'ch1', state);

		expect(mockUpdate).toHaveBeenCalledWith({
			agendaItemStatuses: [
				{
					point: '論点A',
					status: 'introduced',
					introducedOrder: 1,
					spokenPersonaIds: [],
					relevantPersonaIds: ['p1']
				}
			]
		});
	});

	it('2集合が欠損する論点は当該フィールドを書き出さない（後方互換）', async () => {
		const state = makeState([{ point: '論点A', status: 'untouched' }]);

		await saveAgendaItemStatuses('t1', 'ch1', state);

		expect(mockUpdate).toHaveBeenCalledWith({
			agendaItemStatuses: [{ point: '論点A', status: 'untouched' }]
		});
	});
});
