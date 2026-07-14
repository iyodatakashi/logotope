import { describe, it, expect } from 'vitest';
import type { Timestamp } from 'firebase/firestore';
import type { FactItem, FactBase, FactBaseForFirestore } from '$lib/models/factBase/factBase.types';

describe('factBase.types', () => {
	it('FactItem は検証可能な事実文と出典を持つ', () => {
		const fact: FactItem = {
			statement: '2026年のW杯で日本は決勝トーナメント1回戦で敗退した',
			sources: [{ title: 'スポーツ報知', url: 'https://example.com/article' }]
		};
		expect(fact.statement.length).toBeGreaterThan(0);
		expect(fact.sources[0].url).toBe('https://example.com/article');
	});

	it('FactBase は事実配列と生成基準日（Date）を持つ', () => {
		const factBase: FactBase = {
			facts: [{ statement: '具体的事実', sources: [] }],
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
});
