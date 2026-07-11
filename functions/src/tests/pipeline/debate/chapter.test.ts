/**
 * loadChapterProgress: 永続データ（chapter doc）から章進捗（quietStreak / 論点ステータス）を
 * 決定論的に復元することを検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Chapter } from '../../../types/chapter.types.js';

const mockGet = vi.fn();
const mockDoc = vi.fn(() => ({ get: mockGet }));
const mockCollectionGet = vi.fn();
const mockCollection = vi.fn(() => ({ orderBy: () => ({ get: mockCollectionGet }) }));
vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc, collection: mockCollection }))
}));

import {
	loadChapterProgress,
	getChaptersByTopicId,
	getDebateTurnsByTopicId,
	getChapterById
} from '../../../pipeline/debate/chapter.js';

const makeChapter = (agenda: string[] = []): Chapter => ({
	id: 'ch1',
	title: 'テスト章',
	agenda
});

describe('loadChapterProgress', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('quietStreak 未設定なら 0 を返す', async () => {
		mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
		const progress = await loadChapterProgress('t1', 'ch1', makeChapter(['論点A']));
		expect(progress.quietStreak).toBe(0);
	});

	it('quietStreak が永続化されていればその値を返す', async () => {
		mockGet.mockResolvedValue({ exists: true, data: () => ({ quietStreak: 4 }) });
		const progress = await loadChapterProgress('t1', 'ch1', makeChapter(['論点A']));
		expect(progress.quietStreak).toBe(4);
	});

	it('agendaItemStatuses 未設定なら章の論点から untouched 初期化する', async () => {
		mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
		const progress = await loadChapterProgress('t1', 'ch1', makeChapter(['論点A', '論点B']));
		expect(progress.agendaItemStatuses).toEqual([
			{ point: '論点A', status: 'untouched' },
			{ point: '論点B', status: 'untouched' }
		]);
	});

	it('agendaItemStatuses が永続化されていればそれを復元する', async () => {
		mockGet.mockResolvedValue({
			exists: true,
			data: () => ({
				agendaItemStatuses: [
					{ point: '論点A', status: 'addressed' },
					{ point: '論点B', status: 'introduced' }
				]
			})
		});
		const progress = await loadChapterProgress('t1', 'ch1', makeChapter(['論点A', '論点B']));
		expect(progress.agendaItemStatuses).toEqual([
			{ point: '論点A', status: 'addressed' },
			{ point: '論点B', status: 'introduced' }
		]);
	});

	it('agendaItemStatuses の2集合（発言済み・関連参加者）を復元する', async () => {
		mockGet.mockResolvedValue({
			exists: true,
			data: () => ({
				agendaItemStatuses: [
					{
						point: '論点A',
						status: 'introduced',
						introducedOrder: 1,
						spokenPersonaIds: ['p1'],
						relevantPersonaIds: ['p1', 'p2']
					}
				]
			})
		});
		const progress = await loadChapterProgress('t1', 'ch1', makeChapter(['論点A']));
		expect(progress.agendaItemStatuses).toEqual([
			{
				point: '論点A',
				status: 'introduced',
				introducedOrder: 1,
				spokenPersonaIds: ['p1'],
				relevantPersonaIds: ['p1', 'p2']
			}
		]);
	});

	it('2集合が欠損する既存データでも例外なく復元する', async () => {
		mockGet.mockResolvedValue({
			exists: true,
			data: () => ({
				agendaItemStatuses: [{ point: '論点A', status: 'introduced', introducedOrder: 1 }]
			})
		});
		const progress = await loadChapterProgress('t1', 'ch1', makeChapter(['論点A']));
		expect(progress.agendaItemStatuses[0].spokenPersonaIds).toBeUndefined();
		expect(progress.agendaItemStatuses[0].relevantPersonaIds).toBeUndefined();
	});

	it('論点のない章では空配列を返す', async () => {
		mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
		const progress = await loadChapterProgress('t1', 'ch1', makeChapter([]));
		expect(progress.agendaItemStatuses).toEqual([]);
	});

	it('同一の永続データから同一の出力を返す（決定論）', async () => {
		mockGet.mockResolvedValue({
			exists: true,
			data: () => ({
				quietStreak: 2,
				agendaItemStatuses: [{ point: '論点A', status: 'introduced' }]
			})
		});
		const a = await loadChapterProgress('t1', 'ch1', makeChapter(['論点A']));
		const b = await loadChapterProgress('t1', 'ch1', makeChapter(['論点A']));
		expect(a).toEqual(b);
	});
});

/**
 * 永続データからの turns 復元で targetedBy を取りこぼさないことを検証する。
 * これが欠落すると getLastTargetPersona が指名を検出できず、指名応答が常に無視される。
 */
describe('turns 復元で targetedBy を保持する', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const chapterDoc = {
		id: 'ch1',
		data: () => ({
			chapterIndex: 0,
			title: 'テスト章',
			turns: [
				{
					id: 'turn1',
					speakerType: 'persona',
					personaId: 'p1',
					content: '...',
					createdAt: 0,
					targetPersonaId: 'p2',
					targetedBy: 'persona'
				}
			]
		})
	};

	it('getDebateTurnsByTopicId が targetedBy を復元する', async () => {
		mockCollectionGet.mockResolvedValue({ docs: [chapterDoc] });
		const turns = await getDebateTurnsByTopicId('t1');
		expect(turns[0].targetPersonaId).toBe('p2');
		expect(turns[0].targetedBy).toBe('persona');
	});

	it('getChaptersByTopicId（toChapterEntry）が targetedBy を復元する', async () => {
		mockCollectionGet.mockResolvedValue({ docs: [chapterDoc] });
		const chapters = await getChaptersByTopicId('t1');
		expect(chapters[0].turns[0].targetPersonaId).toBe('p2');
		expect(chapters[0].turns[0].targetedBy).toBe('persona');
	});
});

/**
 * 生成中ターン（pendingTurn）を状態再構築・frontier 計上・LLM 文脈へ混入させない（3.1/3.2）。
 * 章 doc に pendingTurn が同居していても、読み出し（turns 復元）は確定 turns[] のみを返す。
 */
describe('生成中ターン（pendingTurn）を確定ターンと分離する（3.1/3.2）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const chapterDocWithPending = {
		id: 'ch1',
		data: () => ({
			chapterIndex: 0,
			title: 'テスト章',
			turns: [
				{
					id: 't1',
					speakerType: 'persona',
					personaId: 'p1',
					content: '確定発言',
					createdAt: 0,
					status: 'evaluating'
				}
			],
			// 生成中の未確定ターン（turns[] 外・frontier に数えない）
			pendingTurn: {
				id: 'pending-x',
				personaId: 'p2',
				expectedTurnIndex: 1,
				status: 'fact-checking'
			}
		})
	};

	it('getDebateTurnsByTopicId はコミット済み turns のみ返し、pendingTurn を混入しない', async () => {
		mockCollectionGet.mockResolvedValue({ docs: [chapterDocWithPending] });
		const turns = await getDebateTurnsByTopicId('t1');
		expect(turns).toHaveLength(1);
		expect(turns.map((turn) => turn.id)).toEqual(['t1']);
		expect(turns.some((turn) => turn.id === 'pending-x')).toBe(false);
	});

	it('toChapterEntry（getChaptersByTopicId）の frontier 計上 turns はコミット済みのみ（pendingTurn を数えない）', async () => {
		mockCollectionGet.mockResolvedValue({ docs: [chapterDocWithPending] });
		const chapters = await getChaptersByTopicId('t1');
		expect(chapters[0].turns).toHaveLength(1); // frontier = 1（pendingTurn は含めない）
		expect(chapters[0].turns[0].id).toBe('t1');
	});
});

/**
 * 回帰: focusQuestion を持つ既存ドキュメントを読み出してもエラーにならず、
 * title / agenda のみで ChapterEntry を構成する（後方互換, 1.4）。
 */
describe('回帰: focusQuestion を持つ既存データの読み出し', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('legacy focusQuestion フィールドは無視され、title / agenda で読み出せる', async () => {
		mockGet.mockResolvedValue({
			exists: true,
			data: () => ({
				chapterIndex: 0,
				title: 'レガシー章',
				focusQuestion: '廃止されたフォーカス問い',
				agenda: ['論点A', '論点B'],
				turns: [],
				status: 'completed'
			})
		});

		const entry = await getChapterById('t1', 'ch1');

		expect(entry).not.toBeNull();
		expect(entry!.title).toBe('レガシー章');
		expect(entry!.agenda).toEqual(['論点A', '論点B']);
		// focusQuestion はランタイム型から廃止済みのため ChapterEntry には現れない
		expect((entry as Record<string, unknown>).focusQuestion).toBeUndefined();
	});
});
