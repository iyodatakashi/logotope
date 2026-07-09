import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import type { EditedChapterForFirestore } from '../../../types/editorial.types.js';

const { holder, mockGetPersonas } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	},
	mockGetPersonas: vi.fn()
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	Timestamp: { now: () => 'TS' }
}));
vi.mock('../../../pipeline/personas/personas.js', () => ({
	getPersonasByTopicId: mockGetPersonas
}));

import {
	startEditingRun,
	isEditingActive,
	finalizeEditingRun,
	stopEditingRun,
	finalizePendingEditorialElements
} from '../../../pipeline/editing/editing-lifecycle.js';

const chapterPath = (chapterId: string) => `topics/t1/editedChapters/${chapterId}`;

const makeChapter = (
	chapterIndex: number,
	status: EditedChapterForFirestore['status']
): EditedChapterForFirestore => ({
	chapterIndex,
	title: `章${chapterIndex}`,
	agenda: [],
	turns: [],
	status
});

beforeEach(() => {
	holder.mock = createFirestoreMock();
	mockGetPersonas.mockReset();
	mockGetPersonas.mockResolvedValue([]);
});

describe('startEditingRun', () => {
	it('既存の編集成果物を破棄し、phase6・running・新 runId を設定する', async () => {
		holder.mock!.store.set('topics/t1', { phase: 'editing', phaseStatus: 'not_started' });
		holder.mock!.store.set(chapterPath('c1'), makeChapter(0, 'completed'));

		const runId = await startEditingRun('t1');

		expect(typeof runId).toBe('string');
		expect(runId.length).toBeGreaterThan(0);
		expect(holder.mock!.store.has(chapterPath('c1'))).toBe(false);
		expect(holder.mock!.store.get('topics/t1')).toMatchObject({
			phase: 'editing',
			phaseStatus: 'running',
			runId
		});
	});

	it('統合保存 editorial/0（導入/締め/所感）を破棄し導入・締め＝生成待ち・所感空で初期化する（作り直しのため）', async () => {
		holder.mock!.store.set('topics/t1', { phase: 'editing', phaseStatus: 'stopped' });
		holder.mock!.store.set('topics/t1/editorial/0', {
			intro: { status: 'finished', draft: '旧導入', final: '旧導入編集後' },
			outro: { status: 'pending', draft: null, final: null },
			impressions: { p1: { sortOrder: 0, status: 'finished', draft: '旧所感', final: '旧所感編集後' } }
		});

		await startEditingRun('t1');

		expect(holder.mock!.store.get('topics/t1/editorial/0')).toEqual({
			intro: { status: 'pending', draft: null, final: null },
			outro: { status: 'pending', draft: null, final: null },
			impressions: {}
		});
	});
});

describe('isEditingActive', () => {
	it('phase6・running・runId 一致なら true', async () => {
		holder.mock!.store.set('topics/t1', { phase: 'editing', phaseStatus: 'running', runId: 'r1' });
		expect(await isEditingActive('t1', 'r1')).toBe(true);
	});

	it('runId 不一致（旧世代）なら false', async () => {
		holder.mock!.store.set('topics/t1', { phase: 'editing', phaseStatus: 'running', runId: 'r1' });
		expect(await isEditingActive('t1', 'r2')).toBe(false);
	});

	it('phaseStatus が running でなければ false', async () => {
		holder.mock!.store.set('topics/t1', {
			phase: 'editing',
			phaseStatus: 'generated',
			runId: 'r1'
		});
		expect(await isEditingActive('t1', 'r1')).toBe(false);
	});
});

describe('finalizeEditingRun', () => {
	beforeEach(() => {
		holder.mock!.store.set('topics/t1', { phase: 'editing', phaseStatus: 'running', runId: 'r1' });
	});

	it('全章 completed なら generated に遷移する', async () => {
		holder.mock!.store.set(chapterPath('c1'), makeChapter(0, 'completed'));
		holder.mock!.store.set(chapterPath('c2'), makeChapter(1, 'completed'));

		expect(await finalizeEditingRun('t1', 'r1')).toBe('generated');
		expect(holder.mock!.store.get('topics/t1')).toMatchObject({ phaseStatus: 'generated' });
	});

	it('failed 章が残れば stopped に留める', async () => {
		holder.mock!.store.set(chapterPath('c1'), makeChapter(0, 'completed'));
		holder.mock!.store.set(chapterPath('c2'), makeChapter(1, 'failed'));

		expect(await finalizeEditingRun('t1', 'r1')).toBe('stopped');
		expect(holder.mock!.store.get('topics/t1')).toMatchObject({ phaseStatus: 'stopped' });
	});

	it('runId 不一致（旧世代）は書き込まず noop', async () => {
		holder.mock!.store.set(chapterPath('c1'), makeChapter(0, 'completed'));

		expect(await finalizeEditingRun('t1', 'stale')).toBe('noop');
		expect(holder.mock!.store.get('topics/t1')).toMatchObject({ phaseStatus: 'running' });
	});

	it('既に generated（前進済み）は巻き戻さず noop', async () => {
		holder.mock!.store.set('topics/t1', {
			phase: 'editing',
			phaseStatus: 'generated',
			runId: 'r1'
		});
		holder.mock!.store.set(chapterPath('c1'), makeChapter(0, 'failed'));

		expect(await finalizeEditingRun('t1', 'r1')).toBe('noop');
		expect(holder.mock!.store.get('topics/t1')).toMatchObject({ phaseStatus: 'generated' });
	});
});

const EDITORIAL_PATH = 'topics/t1/editorial/0';

describe('finalizePendingEditorialElements（終端スイープ）', () => {
	it('生成待ち／生成中／整え中の導入・締めを完了に確定する（既存内容を保持・無ければ空＝生成失敗）', async () => {
		holder.mock!.store.set(EDITORIAL_PATH, {
			intro: { status: 'pending', draft: null, final: null },
			outro: { status: 'editing', draft: '締め原本', final: null },
			impressions: {}
		});

		await finalizePendingEditorialElements('t1');

		const editorial = holder.mock!.store.get(EDITORIAL_PATH) as Record<string, unknown>;
		expect(editorial.intro).toEqual({ status: 'finished', draft: null, final: null }); // 生成失敗
		expect(editorial.outro).toEqual({ status: 'finished', draft: '締め原本', final: null }); // 編集失敗
	});

	it('承認済みペルソナのうちエントリ無し／未完了の所感に失敗エントリを materialize する', async () => {
		mockGetPersonas.mockResolvedValue([
			{ id: 'p1', approved: true },
			{ id: 'p2', approved: true },
			{ id: 'p3', approved: false }
		]);
		holder.mock!.store.set(EDITORIAL_PATH, {
			intro: { status: 'finished', draft: 'i', final: 'i' },
			outro: { status: 'finished', draft: 'o', final: 'o' },
			// p1 は生成中で途中停止、p2 はエントリ無し
			impressions: { p1: { sortOrder: 0, status: 'generating', draft: null, final: null } }
		});

		await finalizePendingEditorialElements('t1');

		const editorial = holder.mock!.store.get(EDITORIAL_PATH) as {
			impressions: Record<string, unknown>;
		};
		expect(editorial.impressions.p1).toEqual({ sortOrder: 0, status: 'finished', draft: null, final: null });
		expect(editorial.impressions.p2).toEqual({ sortOrder: 1, status: 'finished', draft: null, final: null });
		expect(editorial.impressions.p3).toBeUndefined(); // 未承認は対象外
	});

	it('既に finished の要素は変更しない（冪等）', async () => {
		mockGetPersonas.mockResolvedValue([{ id: 'p1', approved: true }]);
		const finished = {
			intro: { status: 'finished', draft: 'i原本', final: 'i編集後' },
			outro: { status: 'finished', draft: null, final: null },
			impressions: { p1: { sortOrder: 0, status: 'finished', draft: 'p原本', final: null } }
		};
		holder.mock!.store.set(EDITORIAL_PATH, structuredClone(finished));

		await finalizePendingEditorialElements('t1');

		expect(holder.mock!.store.get(EDITORIAL_PATH)).toEqual(finished);
	});
});

describe('stopEditingRun（停止＋終端スイープ）', () => {
	it('停止が成立したら未完了要素を生成失敗へ確定する', async () => {
		holder.mock!.store.set('topics/t1', { phase: 'editing', phaseStatus: 'running', runId: 'r1' });
		mockGetPersonas.mockResolvedValue([{ id: 'p1', approved: true }]);
		holder.mock!.store.set(EDITORIAL_PATH, {
			intro: { status: 'generating', draft: null, final: null },
			outro: { status: 'pending', draft: null, final: null },
			impressions: {}
		});

		await stopEditingRun('t1', 'r1');

		expect(holder.mock!.store.get('topics/t1')).toMatchObject({ phaseStatus: 'stopped' });
		const editorial = holder.mock!.store.get(EDITORIAL_PATH) as {
			intro: unknown;
			impressions: Record<string, unknown>;
		};
		expect(editorial.intro).toEqual({ status: 'finished', draft: null, final: null });
		expect(editorial.impressions.p1).toEqual({ sortOrder: 0, status: 'finished', draft: null, final: null });
	});

	it('停止が成立しない（runId 不一致）ならスイープしない', async () => {
		holder.mock!.store.set('topics/t1', { phase: 'editing', phaseStatus: 'running', runId: 'r1' });
		holder.mock!.store.set(EDITORIAL_PATH, {
			intro: { status: 'pending', draft: null, final: null },
			outro: { status: 'pending', draft: null, final: null },
			impressions: {}
		});

		await stopEditingRun('t1', 'stale');

		expect(holder.mock!.store.get('topics/t1')).toMatchObject({ phaseStatus: 'running' });
		expect((holder.mock!.store.get(EDITORIAL_PATH) as { intro: { status: string } }).intro.status).toBe('pending');
	});
});
