/**
 * 事実基盤の一貫性検証（Task 8 / R9.3）。
 * getTopicContext が唯一の権威経路であり、複数の消費者（ステークホルダー/ペルソナ/取材/章立て/討論）が
 * それぞれ呼び出しても、同一トピックに対して同一の事実基盤を得ることをインメモリ Firestore 上で固定する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import { getTopicContext } from '../../../pipeline/topics/topic-context.js';

const TOPIC_ID = 'topic1';
const GENERATED_AT = new Date('2026-07-03T00:00:00Z');

beforeEach(() => {
	vi.clearAllMocks();
	holder.mock = createFirestoreMock();
	holder.mock.store.set(`topics/${TOPIC_ID}`, { title: 'テーマ' });
	holder.mock.store.set(`topics/${TOPIC_ID}/factBase/0`, {
		facts: [{ statement: '確定事実', sources: [{ title: '報知', url: 'https://a' }] }],
		generatedAt: { toDate: () => GENERATED_AT }
	});
});

describe('事実基盤の全消費者一貫性（R9.3）', () => {
	it('複数消費者が独立に取得しても同一の事実基盤を得る（値が一致する）', async () => {
		// 5 消費者ぶんの独立取得を模す
		const contexts = await Promise.all(Array.from({ length: 5 }, () => getTopicContext(TOPIC_ID)));

		const expected = {
			facts: [{ statement: '確定事実', sources: [{ title: '報知', url: 'https://a' }] }],
			generatedAt: GENERATED_AT
		};
		for (const context of contexts) {
			expect(context.factBase).toEqual(expected);
		}
		// 全消費者で厳密に等価（フェーズ別分岐を持たない）
		const serialized = contexts.map((c) => JSON.stringify(c.factBase));
		expect(new Set(serialized).size).toBe(1);
	});

	it('事実基盤が不在なら全消費者で一様に未設定になる', async () => {
		holder.mock!.store.delete(`topics/${TOPIC_ID}/factBase/0`);

		const contexts = await Promise.all(Array.from({ length: 3 }, () => getTopicContext(TOPIC_ID)));
		for (const context of contexts) {
			expect(context.factBase).toBeUndefined();
		}
	});
});
