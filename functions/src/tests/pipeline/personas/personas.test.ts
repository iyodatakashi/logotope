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

import { discardStakeholders, discardPersonas } from '../../../pipeline/personas/personas.js';

beforeEach(() => {
	holder.mock = createFirestoreMock();
});

describe('discardStakeholders', () => {
	it('stakeholders/0 を削除し、他フェーズのデータを残す', async () => {
		holder.mock!.store.set('topics/t1/stakeholders/0', { stakeholders: [] });
		holder.mock!.store.set('topics/t1/personas/p1', { name: 'A' });

		await discardStakeholders('t1');

		expect(holder.mock!.store.has('topics/t1/stakeholders/0')).toBe(false);
		expect(holder.mock!.store.has('topics/t1/personas/p1')).toBe(true);
	});

	it('既に無い場合は no-op（冪等）', async () => {
		await expect(discardStakeholders('t1')).resolves.toBeUndefined();
	});
});

describe('discardPersonas', () => {
	it('personas サブコレクションを全削除し、他フェーズのデータを残す', async () => {
		holder.mock!.store.set('topics/t1/personas/p1', { name: 'A' });
		holder.mock!.store.set('topics/t1/personas/p2', { name: 'B' });
		holder.mock!.store.set('topics/t1/stakeholders/0', { stakeholders: [] });
		holder.mock!.store.set('topics/t1/chapters/c1', { chapterIndex: 0 });

		await discardPersonas('t1');

		expect(holder.mock!.store.has('topics/t1/personas/p1')).toBe(false);
		expect(holder.mock!.store.has('topics/t1/personas/p2')).toBe(false);
		expect(holder.mock!.store.has('topics/t1/stakeholders/0')).toBe(true);
		expect(holder.mock!.store.has('topics/t1/chapters/c1')).toBe(true);
	});

	it('空コレクションは no-op（冪等）', async () => {
		await expect(discardPersonas('t1')).resolves.toBeUndefined();
	});
});
