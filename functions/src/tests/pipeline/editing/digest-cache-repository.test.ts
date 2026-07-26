import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import type { DebateDigest } from '../../../types/debate-digest.types.js';

const { holder } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	}
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore
}));

import {
	readDigestCache,
	writeDigestCache,
	clearDigestCache
} from '../../../pipeline/editing/digest-cache-repository.js';

const DIGEST_PATH = 'topics/t1/editorial/digest';

const digest = (): DebateDigest => ({
	topicTitle: 'テーマ',
	chapters: [{ title: '第1章', agenda: ['論点'], summary: '要約' }],
	personas: [{ personaId: 'p1', name: 'p1', stance: '立場', beliefShifts: ['気づき'] }]
});

beforeEach(() => {
	holder.mock = createFirestoreMock();
});

describe('digest-cache-repository', () => {
	it('未保存なら read は null を返す', async () => {
		expect(await readDigestCache('t1')).toBeNull();
	});

	it('write した内容を read で同一に読み戻せる（editorial/digest に保存）', async () => {
		await writeDigestCache('t1', digest());
		expect(holder.mock!.store.has(DIGEST_PATH)).toBe(true);
		expect(await readDigestCache('t1')).toEqual(digest());
	});

	it('write は DebateDigest と同一の形で保存する（追加フィールドを混ぜない）', async () => {
		await writeDigestCache('t1', digest());
		expect(holder.mock!.store.get(DIGEST_PATH)).toEqual(digest());
	});

	it('write は上書き保存する', async () => {
		await writeDigestCache('t1', digest());
		const updated: DebateDigest = { ...digest(), topicTitle: '別テーマ' };
		await writeDigestCache('t1', updated);
		expect(await readDigestCache('t1')).toEqual(updated);
	});

	it('clear 後の read は null を返す', async () => {
		await writeDigestCache('t1', digest());
		await clearDigestCache('t1');
		expect(holder.mock!.store.has(DIGEST_PATH)).toBe(false);
		expect(await readDigestCache('t1')).toBeNull();
	});

	it('未存在に対する clear も成功する（冪等）', async () => {
		await expect(clearDigestCache('t1')).resolves.toBeUndefined();
	});
});
