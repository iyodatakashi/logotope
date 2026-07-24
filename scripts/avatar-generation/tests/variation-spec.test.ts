import { describe, it, expect } from 'vitest';
import {
	HAIR_CATALOG,
	AGE_BAND_CODE,
	SERIAL_REGISTRY,
	resolveVariation,
	hairCatalogFor,
	assetFileName
} from '../variation-spec';

describe('髪型カタログ', () => {
	it('全 (年齢帯 × 性別) バケットに1件以上の髪型がある（Req 2.1）', () => {
		for (const ageBand of Object.keys(HAIR_CATALOG) as (keyof typeof HAIR_CATALOG)[]) {
			for (const gender of Object.keys(
				HAIR_CATALOG[ageBand]
			) as (keyof (typeof HAIR_CATALOG)[typeof ageBand])[]) {
				expect(hairCatalogFor(ageBand, gender).length).toBeGreaterThan(0);
			}
		}
	});

	it('各バケット内で髪型名が重複しない（見分けのつく別個体・Req 2.3）', () => {
		for (const ageBand of Object.keys(HAIR_CATALOG) as (keyof typeof HAIR_CATALOG)[]) {
			for (const gender of Object.keys(
				HAIR_CATALOG[ageBand]
			) as (keyof (typeof HAIR_CATALOG)[typeof ageBand])[]) {
				const styles = hairCatalogFor(ageBand, gender);
				expect(new Set(styles).size).toBe(styles.length);
			}
		}
	});
});

describe('serial ↔ 髪型 の対応（カタログ順に依存しない安定通し番号・Req 2.4）', () => {
	it('同一バケット内で serial が一意', () => {
		const seen = new Set<string>();
		for (const individual of SERIAL_REGISTRY) {
			const key = `${individual.ageBand}/${individual.gender}/${individual.serial}`;
			expect(seen.has(key)).toBe(false);
			seen.add(key);
		}
	});

	it('登録個体の髪型はすべて対象バケットのカタログに存在する', () => {
		for (const individual of SERIAL_REGISTRY) {
			expect(hairCatalogFor(individual.ageBand, individual.gender)).toContain(individual.hairStyle);
		}
	});

	it('(年齢帯 × 性別 × serial) から生成対象が一意に定まる（Req 2.4）', () => {
		const sample = SERIAL_REGISTRY[0];
		const resolved = resolveVariation(sample.ageBand, sample.gender, sample.serial);
		expect(resolved).toEqual(sample);
	});

	it('未登録の serial は解決できずエラーになる', () => {
		expect(() => resolveVariation('thirties_forties', 'female', '99')).toThrow();
	});
});

describe('命名規則（Req 2.4）', () => {
	it('全年齢帯に neutral（中性的）のカタログがある', () => {
		for (const ageBand of Object.keys(HAIR_CATALOG) as (keyof typeof HAIR_CATALOG)[]) {
			expect(hairCatalogFor(ageBand, 'neutral').length).toBeGreaterThan(0);
		}
	});

	it('{ageBandCode}_{gender}_{serial}.png 形式で、年齢帯コードは範囲が自明', () => {
		expect(AGE_BAND_CODE.thirties_forties).toBe('30s40s');
		const individual = resolveVariation('thirties_forties', 'female', '01');
		expect(assetFileName(individual)).toBe('30s40s_female_01.png');
	});
});
