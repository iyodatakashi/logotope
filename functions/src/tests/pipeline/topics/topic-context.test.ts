/**
 * getTopicContext のユニットテスト（Task 5）。
 * インメモリ Firestore 上で topic doc と factBase/0 を合成し、
 * 事実基盤あり／なしで正しい共有コンテキストを返すことを検証する。
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
const tsOf = (d: Date) => ({ toDate: () => d });

beforeEach(() => {
	vi.clearAllMocks();
	holder.mock = createFirestoreMock();
});

describe('getTopicContext', () => {
	it('factBase/0 が存在すれば facts と生成基準日（Date）を合成する', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, {
			title: 'テーマ',
			description: 'テーマ説明'
		});
		holder.mock!.store.set(`topics/${TOPIC_ID}/factBase/0`, {
			facts: [{ statement: '事実', sources: [{ title: 'a', url: 'https://a' }] }],
			generatedAt: tsOf(GENERATED_AT)
		});

		const context = await getTopicContext(TOPIC_ID);

		expect(context.factBase).toEqual({
			facts: [{ statement: '事実', sources: [{ title: 'a', url: 'https://a' }] }],
			generatedAt: GENERATED_AT
		});
		expect(context.description).toBe('テーマ説明');
	});

	it('factBase/0 が存在しなければ factBase 未設定で、テーマ説明・参考資料は踏襲する', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, {
			title: 'テーマ',
			description: 'テーマ説明',
			fetchedSourceContents: [{ content: '資料1' }, { content: '資料2' }]
		});

		const context = await getTopicContext(TOPIC_ID);

		expect(context.factBase).toBeUndefined();
		expect(context.description).toBe('テーマ説明');
		expect(context.sourceContents).toEqual(['資料1', '資料2']);
	});

	it('fetchedSourceContents を sourceContents（content 配列）に写像する', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, {
			title: 'テーマ',
			fetchedSourceContents: [{ content: '本文A' }, { content: '本文B' }]
		});

		const context = await getTopicContext(TOPIC_ID);

		expect(context.sourceContents).toEqual(['本文A', '本文B']);
	});

	it('factBase/0 が facts:[] で存在すれば空の事実基盤を設定する（doc 存在＝空でも設定）', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { title: 'テーマ' });
		holder.mock!.store.set(`topics/${TOPIC_ID}/factBase/0`, {
			facts: [],
			generatedAt: tsOf(GENERATED_AT)
		});

		const context = await getTopicContext(TOPIC_ID);

		expect(context.factBase).toEqual({ facts: [], generatedAt: GENERATED_AT });
	});

	it('description・参考資料・事実基盤がすべて無ければ空の共有コンテキストを返す', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { title: 'テーマ' });

		const context = await getTopicContext(TOPIC_ID);

		expect(context).toEqual({});
	});

	it('トピックが存在しなければエラーを投げる（前提: topic が存在する）', async () => {
		await expect(getTopicContext('missing')).rejects.toThrow(/not found/i);
	});
});
