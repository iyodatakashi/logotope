import { describe, it, expect } from 'vitest';
import type { Timestamp } from 'firebase-admin/firestore';
import type {
	FactItem,
	FactBase,
	FactBaseForFirestore,
	TopicContext
} from '../../types/topic.types.js';

describe('fact-base types (BE)', () => {
	it('FactItem は検証可能な事実文と出典を持つ', () => {
		const fact: FactItem = {
			statement: '具体的事実',
			sources: [{ title: '媒体名', url: 'https://example.com' }]
		};
		expect(fact.sources[0].title).toBe('媒体名');
	});

	it('FactBase は事実配列と生成基準日（Date）を持つ', () => {
		const factBase: FactBase = {
			facts: [{ statement: '事実', sources: [] }],
			generatedAt: new Date('2026-07-03T00:00:00Z')
		};
		expect(factBase.facts).toHaveLength(1);
		expect(factBase.generatedAt).toBeInstanceOf(Date);
	});

	it('FactBase は事実なしを空配列で表現できる（縮退）', () => {
		const empty: FactBase = { facts: [], generatedAt: new Date() };
		expect(empty.facts).toEqual([]);
	});

	it('FactBaseForFirestore は generatedAt を Timestamp で永続する', () => {
		const persisted: FactBaseForFirestore = {
			facts: [],
			generatedAt: { seconds: 0, nanoseconds: 0 } as Timestamp
		};
		expect(persisted.facts).toEqual([]);
	});

	it('TopicContext は factBase を sourceContents とは別フィールドとして保持できる', () => {
		const context: TopicContext = {
			description: 'テーマ説明',
			sourceContents: ['ユーザー提供資料'],
			factBase: { facts: [], generatedAt: new Date() }
		};
		expect(context.factBase?.facts).toEqual([]);
	});
});
