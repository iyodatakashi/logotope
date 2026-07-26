import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../helpers/firestore-mock.js';

const { holder } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	}
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore
}));

import { backfillTopicOutputs } from '../../scripts/backfill-editorial-outputs.js';

const LEGACY_PATH = 'topics/t1/editorial/0';
const OUTPUTS_PATH = 'topics/t1/editorial/outputs';

const editorial = () => ({
	intro: { status: 'finished', draft: '導入原本', final: '導入編集後' },
	outro: { status: 'finished', draft: null, final: null },
	impressions: { p1: { sortOrder: 0, status: 'finished', draft: '所感', final: '所感編集後' } }
});

beforeEach(() => {
	holder.mock = createFirestoreMock();
});

describe('backfillTopicOutputs', () => {
	it('editorial/0 の内容を editorial/outputs へコピーする（apply）', async () => {
		holder.mock!.store.set(LEGACY_PATH, editorial());

		const result = await backfillTopicOutputs('t1', true);

		expect(result).toBe('copied');
		expect(holder.mock!.store.get(OUTPUTS_PATH)).toEqual(editorial());
		// 旧ドキュメントは残す（ロールバック可能性のため削除しない）
		expect(holder.mock!.store.get(LEGACY_PATH)).toEqual(editorial());
	});

	it('editorial/outputs が既にあればスキップし上書きしない（冪等・再実行安全）', async () => {
		holder.mock!.store.set(LEGACY_PATH, editorial());
		const existing = { intro: { status: 'finished', draft: '既存', final: '既存' }, outro: editorial().outro, impressions: {} };
		holder.mock!.store.set(OUTPUTS_PATH, existing);

		const result = await backfillTopicOutputs('t1', true);

		expect(result).toBe('skipped-exists');
		expect(holder.mock!.store.get(OUTPUTS_PATH)).toEqual(existing);
	});

	it('editorial/0 が無ければ何もしない', async () => {
		const result = await backfillTopicOutputs('t1', true);

		expect(result).toBe('skipped-no-source');
		expect(holder.mock!.store.has(OUTPUTS_PATH)).toBe(false);
	});

	it('dry-run（apply=false）では書き込まずコピー予定だけ返す', async () => {
		holder.mock!.store.set(LEGACY_PATH, editorial());

		const result = await backfillTopicOutputs('t1', false);

		expect(result).toBe('copied');
		expect(holder.mock!.store.has(OUTPUTS_PATH)).toBe(false);
	});
});
