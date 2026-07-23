import { describe, it, expect } from 'vitest';
import {
	resolveVariation,
	composeHair,
	describeHair,
	selectAesthetic,
	BODY_CATALOG,
	GLASSES_SHAPE_CATALOG,
	GLASSES_RIM_CATALOG,
	type HairChoice
} from '../../avatar/avatar-variation';
import { GENERATIONS, PRESENTATIONS } from '../../avatar/avatar-seeds';

// 全世代×外見表現で多数サンプリングし、組み立て（composeHair）の不変条件を検証する。
// バイアスフリー方針なので固定リストとの一致ではなく「成立条件・ハード制約・重みで消えないこと」を見る。
const ALL_CASES = GENERATIONS.flatMap((g) => PRESENTATIONS.map((p) => ({ g, p })));
const samples = (g: (typeof GENERATIONS)[number], p: (typeof PRESENTATIONS)[number], n = 400) =>
	Array.from({ length: n }, () => composeHair(g, p));

const startsWith = (s: string | undefined, prefix: string) => !!s && s.startsWith(prefix);

describe('composeHair — スタイリング状態', () => {
	it('VS/S は必ずおろし（まとめにならない）', () => {
		for (const { g, p } of ALL_CASES) {
			for (const c of samples(g, p)) {
				if (c.length === 'VS' || c.length === 'S') expect(c.styling).toBe('down');
			}
		}
	});

	it('まとめは B/M/SL/L のみ。おろしは bangs/silhouette を持ち、まとめは tie を持つ', () => {
		for (const { g, p } of ALL_CASES) {
			for (const c of samples(g, p)) {
				if (c.styling === 'tied') {
					expect(['B', 'M', 'SL', 'L']).toContain(c.length);
					expect(typeof c.tie).toBe('string');
					expect(c.bangs).toBeUndefined();
				} else {
					expect(typeof c.bangs).toBe('string');
					expect(typeof c.silhouette).toBe('string');
					expect(c.tie).toBeUndefined();
				}
			}
		}
	});
});

describe('composeHair — おろし時の成立条件', () => {
	it('触覚は B 以上でのみ出る', () => {
		for (const { g, p } of ALL_CASES) {
			for (const c of samples(g, p)) {
				if (startsWith(c.bangs, '触覚')) expect(['B', 'M', 'SL', 'L']).toContain(c.length);
			}
		}
	});

	it('シルエットは長さの成立条件を満たす', () => {
		const okLengths: Record<string, string[]> = {
			マッシュ: ['S', 'B', 'M'],
			ウルフ: ['S', 'B', 'M', 'SL', 'L'],
			スラント: ['B', 'M', 'SL', 'L'],
			テクスチャー: ['VS', 'S', 'B', 'M'],
			フェイスフレーミング: ['M', 'SL', 'L']
		};
		for (const { g, p } of ALL_CASES) {
			for (const c of samples(g, p)) {
				for (const [prefix, lengths] of Object.entries(okLengths)) {
					if (startsWith(c.silhouette, prefix)) expect(lengths).toContain(c.length);
				}
			}
		}
	});

	it('カール/パーマ のときだけ質感を持たない（それ以外は質感を持つ）', () => {
		for (const { g, p } of ALL_CASES) {
			for (const c of samples(g, p)) {
				if (c.styling !== 'down') continue;
				if (startsWith(c.silhouette, 'カール/パーマ')) expect(c.texture).toBeUndefined();
				else expect(typeof c.texture).toBe('string');
			}
		}
	});
});

describe('composeHair — ハード制約', () => {
	it('ツインテールは feminine の child/young のみ、かつ長さ M', () => {
		for (const { g, p } of ALL_CASES) {
			for (const c of samples(g, p)) {
				if (startsWith(c.tie, 'ツインテール')) {
					expect(p).toBe('feminine');
					expect(['child', 'young']).toContain(g);
					expect(c.length).toBe('M');
				}
			}
		}
	});

	it('feminine child/young ではツインテールが実際に出る（ハード除外で消えていない）', () => {
		const ties = samples('young', 'feminine', 3000)
			.filter((c) => c.styling === 'tied')
			.map((c) => c.tie);
		expect(ties.some((t) => startsWith(t, 'ツインテール'))).toBe(true);
	});

	it('お団子は masculine の child では出ない', () => {
		for (const c of samples('child', 'masculine', 3000)) {
			expect(startsWith(c.tie, 'お団子')).toBe(false);
		}
	});
});

describe('composeHair — 重みで消えないこと', () => {
	it('feminine/middle で全6長さ・おろし/まとめの両方が現れる', () => {
		const cs = samples('middle', 'feminine', 4000);
		expect(new Set(cs.map((c) => c.length))).toEqual(new Set(['VS', 'S', 'B', 'M', 'SL', 'L']));
		expect(new Set(cs.map((c) => c.styling))).toEqual(new Set(['down', 'tied']));
	});

	it('masculine でもまとめ髪が現れる（下げすぎない）', () => {
		const cs = samples('middle', 'masculine', 2000);
		expect(cs.some((c) => c.styling === 'tied')).toBe(true);
	});
});

describe('describeHair', () => {
	it('おろし・まとめのどちらも長さラベルを含む非空の一文を返す', () => {
		const down: HairChoice = {
			length: 'M',
			styling: 'down',
			bangs: 'シースルー/カーテンバング',
			silhouette: 'ウルフ（段差レイヤー・毛先はね）',
			texture: 'ゆるウェーブ'
		};
		const tied: HairChoice = { length: 'SL', styling: 'tied', tie: 'ローポニーテール' };
		expect(describeHair(down)).toContain('ミディアム');
		expect(describeHair(down)).toContain('ウルフ');
		expect(describeHair(tied)).toContain('セミロング');
		expect(describeHair(tied)).toContain('ローポニーテール');
	});
});

describe('selectAesthetic', () => {
	it('外見表現ごとの有効コードのみを引き、「なし」(null) も現れる', () => {
		const fem = Array.from({ length: 400 }, () => selectAesthetic('feminine'));
		expect(fem).not.toContain('barber shop style'); // female はバーバー系なし
		expect(fem).toContain('ulzzang style');
		expect(fem).toContain(null);

		const male = Array.from({ length: 400 }, () => selectAesthetic('masculine'));
		expect(male).not.toContain('ulzzang style'); // male はオルチャンなし
		expect(male).toContain('barber shop style');

		const neu = Array.from({ length: 400 }, () => selectAesthetic('androgynous'));
		expect(neu).toContain('ulzzang style');
		expect(neu).toContain('barber shop style');
	});
});

describe('resolveVariation', () => {
	it('hair は非空文字列、aestheticKeyword は string|null、体型/メガネは各カタログから引く', () => {
		const v = resolveVariation('middle', 'masculine');
		expect(v.hair.length).toBeGreaterThan(0);
		expect(['string', 'object']).toContain(typeof v.aestheticKeyword); // string または null
		expect(BODY_CATALOG).toContain(v.body);
		expect(typeof v.glasses).toBe('boolean');
		expect(GLASSES_SHAPE_CATALOG).toContain(v.glassesShape);
		expect(GLASSES_RIM_CATALOG).toContain(v.glassesRim);
	});

	it('生成のたびにランダムで、髪型・体型・メガネの形状/縁がそれぞれ複数に散る', () => {
		const vs = Array.from({ length: 300 }, () => resolveVariation('young', 'feminine'));
		expect(new Set(vs.map((v) => v.hair)).size).toBeGreaterThan(1);
		expect(new Set(vs.map((v) => v.body)).size).toBeGreaterThan(1);
		expect(new Set(vs.map((v) => v.glassesShape)).size).toBeGreaterThan(1);
		expect(new Set(vs.map((v) => v.glassesRim)).size).toBeGreaterThan(1);
	});

	it('メガネは着けたり着けなかったりする（両方が現れる）', () => {
		const glasses = Array.from({ length: 300 }, () => resolveVariation('middle', 'feminine').glasses);
		expect(glasses).toContain(true);
		expect(glasses).toContain(false);
	});
});
