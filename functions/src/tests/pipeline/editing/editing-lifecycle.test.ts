import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import type { EditedChapterForFirestore } from '../../../types/editorial.types.js';

const { holder } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	}
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	Timestamp: { now: () => 'TS' }
}));

import {
	startEditingRun,
	isEditingActive,
	finalizeEditingRun
} from '../../../pipeline/editing/editing-lifecycle.js';

const chapterPath = (chapterId: string) => `topics/t1/editedChapters/${chapterId}`;

const makeChapter = (
	chapterIndex: number,
	status: EditedChapterForFirestore['status']
): EditedChapterForFirestore => ({
	chapterIndex,
	title: `章${chapterIndex}`,
	discussionPoints: [],
	turns: [],
	status
});

beforeEach(() => {
	holder.mock = createFirestoreMock();
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

	it('統合保存 editorial/0（導入/締め/所感）を破棄・初期化する（編集し直し＝作り直しのため）', async () => {
		holder.mock!.store.set('topics/t1', { phase: 'editing', phaseStatus: 'stopped' });
		holder.mock!.store.set('topics/t1/editorial/0', {
			intro: { draft: '旧導入', final: '旧導入編集後' },
			outro: { draft: null, final: null },
			impressions: { p1: { sortOrder: 0, draft: '旧所感', final: '旧所感編集後' } }
		});

		await startEditingRun('t1');

		expect(holder.mock!.store.get('topics/t1/editorial/0')).toEqual({
			intro: { draft: null, final: null },
			outro: { draft: null, final: null },
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
