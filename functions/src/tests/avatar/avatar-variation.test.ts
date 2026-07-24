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
			フェイスフレーミング: ['M', 'SL', 'L'],
			'刈り上げ/フェード': ['VS', 'S', 'B'],
			'ツーブロック/アンダーカット': ['S', 'B', 'M']
		};
		for (const { g, p } of ALL_CASES) {
			for (const c of samples(g, p)) {
				for (const [prefix, lengths] of Object.entries(okLengths)) {
					if (startsWith(c.silhouette, prefix)) expect(lengths).toContain(c.length);
				}
			}
		}
	});

	it('長い髪前提の要素（カーテンバング・全体巻き・ウェーブ）は短い髪（VS/S）には出さない', () => {
		for (const { g, p } of ALL_CASES) {
			for (const c of samples(g, p)) {
				if (c.length !== 'VS' && c.length !== 'S') continue;
				expect(startsWith(c.bangs, 'シースルー/カーテンバング')).toBe(false);
				expect(startsWith(c.silhouette, 'カール/パーマ')).toBe(false);
				expect(c.texture).not.toBe('ゆるウェーブ'); // 短い髪はストレートのみ
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
			texture: 'ゆるウェーブ',
			color: '黒髪',
			density: 'ふさふさ'
		};
		const tied: HairChoice = {
			length: 'SL',
			styling: 'tied',
			tie: 'ローポニーテール',
			color: '黒髪',
			density: 'ふさふさ'
		};
		expect(describeHair(down)).toContain('ミディアム');
		expect(describeHair(down)).toContain('ウルフ');
		expect(describeHair(tied)).toContain('セミロング');
		expect(describeHair(tied)).toContain('ローポニーテール');
	});

	it('加齢特徴（白髪・生え際後退）は非既定のときだけ記述に足す', () => {
		const aged: HairChoice = {
			length: 'S',
			styling: 'down',
			bangs: '前髪なし（額出し）',
			silhouette: 'クリーン（タイト・一枚岩）',
			texture: 'ストレート',
			color: 'グレイ／白髪',
			density: '生え際後退'
		};
		expect(describeHair(aged)).toContain('白髪');
		expect(describeHair(aged)).toContain('生え際');
		// 既定（黒髪・ふさふさ）は足さない
		const plain: HairChoice = { ...aged, color: '黒髪', density: 'ふさふさ' };
		expect(describeHair(plain)).not.toContain('白髪');
		expect(describeHair(plain)).not.toContain('生え際');
	});
});

describe('selectAesthetic — 外見表現＋年齢', () => {
	it('外見表現の制約: female はバーバーなし、male はオルチャンなし、「なし」も出る', () => {
		const femYoung = Array.from({ length: 400 }, () => selectAesthetic('young', 'feminine'));
		expect(femYoung).not.toContain('barber shop style');
		expect(femYoung).toContain('ulzzang style');
		expect(femYoung).toContain(null);

		const maleAdult = Array.from({ length: 400 }, () => selectAesthetic('middle', 'masculine'));
		expect(maleAdult).not.toContain('ulzzang style');
		expect(maleAdult).toContain('barber shop style');
	});

	it('年齢で出し分け: 若年はトレンド系、高齢はトレンド系が出ずクリーン/クラシック系のみ', () => {
		const young = Array.from({ length: 800 }, () => selectAesthetic('young', 'neutral'));
		expect(young).toContain('Y2K style');
		expect(young).toContain('ulzzang style');

		const elder = Array.from({ length: 800 }, () => selectAesthetic('elder', 'neutral'));
		expect(elder).not.toContain('Y2K style');
		expect(elder).not.toContain('ulzzang style');
		expect(elder).not.toContain('street fashion style');
		expect(elder).toContain('barber shop style'); // 大人向けは高齢でも出る
	});
});

describe('composeHair — 加齢（髪色・生え際/毛量）', () => {
	it('子ども・若年は黒髪で、加齢の薄毛は出ない（毛量は豊か or ふさふさ）', () => {
		for (const g of ['child', 'young'] as const) {
			for (const p of PRESENTATIONS) {
				for (const c of samples(g, p, 300)) {
					expect(c.color).toBe('黒髪');
					expect(['毛量豊か', 'ふさふさ']).toContain(c.density);
				}
			}
		}
	});

	it('毛量豊か（若々しい毛量）は子ども・若年でだけ出る', () => {
		for (const { g, p } of ALL_CASES) {
			for (const c of samples(g, p, 400)) {
				if (c.density === '毛量豊か') expect(['child', 'young']).toContain(g);
			}
		}
		// 若年では実際に毛量豊かが現れる
		expect(samples('young', 'masculine', 800).some((c) => c.density === '毛量豊か')).toBe(true);
	});

	it('高齢は白髪/グレイが出て、色が複数に散る', () => {
		const cs = samples('elder', 'masculine', 2000);
		expect(cs.some((c) => c.color !== '黒髪')).toBe(true);
		expect(new Set(cs.map((c) => c.color)).size).toBeGreaterThan(1);
	});

	it('高齢男性は生え際後退・薄毛が出る', () => {
		const cs = samples('elder', 'masculine', 2000);
		expect(cs.some((c) => c.density === '生え際後退')).toBe(true);
		expect(cs.some((c) => c.density !== 'ふさふさ')).toBe(true);
	});

	it('女性は男性型の生え際後退・著しい薄毛を出さない（全世代）', () => {
		for (const g of GENERATIONS) {
			for (const c of samples(g, 'feminine', 500)) {
				expect(c.density).not.toBe('生え際後退');
				expect(c.density).not.toBe('著しい薄毛');
			}
		}
	});

	it('著しい薄毛は短い髪（VS/S）でだけ出る', () => {
		for (const { g, p } of ALL_CASES) {
			for (const c of samples(g, p, 400)) {
				if (c.density === '著しい薄毛') expect(['VS', 'S']).toContain(c.length);
			}
		}
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
		const glasses = Array.from(
			{ length: 300 },
			() => resolveVariation('middle', 'feminine').glasses
		);
		expect(glasses).toContain(true);
		expect(glasses).toContain(false);
	});
});
