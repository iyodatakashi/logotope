import { describe, it, expect } from 'vitest';
import { assignSurnames } from '../../../pipeline/personas/surname-assignment.js';
import { NATIONAL_SURNAMES, REGIONAL_SURNAMES } from '../../../constants/japanese-surnames.js';
import { REGIONAL_RATIO } from '../../../constants/surname-regions.js';

const names = (entries: ReadonlyArray<readonly [string, number]>) => entries.map(([n]) => n);

/** random() の戻り値を並べた順に返す。地域リストを引くかどうかの分岐を固定するために使う */
const sequence = (values: number[]) => {
	let i = 0;
	return () => values[i++ % values.length];
};

describe('assignSurnames', () => {
	it('居住地が沖縄なら沖縄の姓を割り当てる', () => {
		// 1つめの乱数で地域判定（0 < REGIONAL_RATIO.沖縄）、2つめで地域リストからの抽選
		const [surname] = assignSurnames(['沖縄県'], sequence([0, 0]));
		expect(names(REGIONAL_SURNAMES['沖縄'])).toContain(surname);
	});

	it('地域判定に外れた場合は全国の姓へ落とす', () => {
		const [surname] = assignSurnames(['沖縄県'], sequence([0.99, 0]));
		expect(names(REGIONAL_SURNAMES['沖縄'])).not.toContain(surname);
		expect(names(NATIONAL_SURNAMES)).toContain(surname);
	});

	it('地域色を持たない県は全国の姓から引く', () => {
		const [surname] = assignSurnames(['東京都'], sequence([0, 0]));
		expect(names(NATIONAL_SURNAMES)).toContain(surname);
	});

	it('同じキャスト内で姓が重複しない', () => {
		// 抽選乱数を常に 0 に固定しても、使用済みを候補から外すので同じ姓は出ない
		const surnames = assignSurnames(Array(8).fill('東京都'), () => 0);
		expect(new Set(surnames).size).toBe(surnames.length);
	});

	it('日本人でないペルソナ（null）には姓を割り当てない', () => {
		expect(assignSurnames([null, '東京都'], () => 0)).toEqual(['', expect.any(String)]);
	});

	it('沖縄の姓を使い切っても全国の姓へ落ちて空にならない', () => {
		const count = REGIONAL_SURNAMES['沖縄'].length + 5;
		const surnames = assignSurnames(Array(count).fill('沖縄県'), () => 0);
		expect(surnames.every((surname) => surname.length > 0)).toBe(true);
		expect(new Set(surnames).size).toBe(count);
	});

	it('REGIONAL_RATIO は全地域で 0..1 に収まる', () => {
		for (const ratio of Object.values(REGIONAL_RATIO)) {
			expect(ratio).toBeGreaterThan(0);
			expect(ratio).toBeLessThanOrEqual(1);
		}
	});

	it('全国の姓リストに重複が無い（同じ姓が二重に候補へ入らない）', () => {
		expect(new Set(names(NATIONAL_SURNAMES)).size).toBe(NATIONAL_SURNAMES.length);
	});
});

describe('姓テーブルの規模', () => {
	// 語彙が痩せると地域の姓がすぐ一巡して「また同じ姓」に戻る。生成し直した表が薄くなっていないかを見る。
	const MINIMUM = {
		沖縄: 120,
		東北: 300,
		北陸: 300,
		南九州: 80,
		北部九州: 300,
		近畿: 300,
		中国四国: 300
	};

	it('全国の姓を5000持つ', () => {
		expect(NATIONAL_SURNAMES.length).toBe(5000);
	});

	it.each(Object.entries(MINIMUM))('%s の姓が %d 以上ある', (region, minimum) => {
		expect(
			REGIONAL_SURNAMES[region as keyof typeof REGIONAL_SURNAMES].length
		).toBeGreaterThanOrEqual(minimum);
	});

	it('重みがすべて正（重み0の姓は決して選ばれないので候補に含めない）', () => {
		const all = [NATIONAL_SURNAMES, ...Object.values(REGIONAL_SURNAMES)].flat();
		expect(all.every(([, weight]) => weight > 0)).toBe(true);
	});

	it('沖縄の姓に沖縄固有の姓が入っている', () => {
		const surnames = names(REGIONAL_SURNAMES['沖縄']);
		for (const expected of ['比嘉', '金城', '大城', '具志堅', '喜屋武', '仲村渠']) {
			expect(surnames).toContain(expected);
		}
	});

	it('沖縄の姓に全国的な頻出姓が紛れていない', () => {
		const surnames = names(REGIONAL_SURNAMES['沖縄']);
		for (const national of ['佐藤', '鈴木', '高橋', '田中', '渡辺']) {
			expect(surnames).not.toContain(national);
		}
	});
});

describe('割り当ての分布', () => {
	// 「また同じ姓」が起きないことを、実際に多数回引いて確かめる（重み付き抽選の効き目の確認）。
	const drawMany = (prefecture: string, casts: number) =>
		Array.from({ length: casts }, () => assignSurnames([prefecture])[0]);

	it('沖縄の姓を200回引いても特定の姓に偏らない', () => {
		const drawn = drawMany('沖縄県', 200);
		const counts = new Map<string, number>();
		for (const surname of drawn) counts.set(surname, (counts.get(surname) ?? 0) + 1);
		// 最頻の姓でも全体の1割を超えない（沖縄で最も多い比嘉でもこの水準に収まる）
		expect(Math.max(...counts.values())).toBeLessThan(drawn.length * 0.1);
		expect(counts.size).toBeGreaterThan(50);
	});

	it('東京の姓を200回引いても特定の姓に偏らない', () => {
		const drawn = drawMany('東京都', 200);
		expect(new Set(drawn).size).toBeGreaterThan(150);
	});
});
