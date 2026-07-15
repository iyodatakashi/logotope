import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';

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

import { discardChaptersWithAnalysis } from '../../../pipeline/chapters/chapter-discard.js';

beforeEach(() => {
	holder.mock = createFirestoreMock();
});

describe('discardChaptersWithAnalysis', () => {
	it('chapters コレクションと chapterAnalysis/0 を削除し、他フェーズのデータを残す', async () => {
		holder.mock!.store.set('topics/t1/chapters/c1', { chapterIndex: 0 });
		holder.mock!.store.set('topics/t1/chapters/c2', { chapterIndex: 1 });
		holder.mock!.store.set('topics/t1/chapterAnalysis/0', { issues: [] });
		holder.mock!.store.set('topics/t1/personas/p1', { name: 'A' });

		await discardChaptersWithAnalysis('t1');

		expect(holder.mock!.store.has('topics/t1/chapters/c1')).toBe(false);
		expect(holder.mock!.store.has('topics/t1/chapters/c2')).toBe(false);
		expect(holder.mock!.store.has('topics/t1/chapterAnalysis/0')).toBe(false);
		expect(holder.mock!.store.has('topics/t1/personas/p1')).toBe(true);
	});

	it('既に無い場合は no-op（冪等）', async () => {
		await expect(discardChaptersWithAnalysis('t1')).resolves.toBeUndefined();
	});
});
