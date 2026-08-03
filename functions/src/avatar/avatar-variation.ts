// 可変軸のカタログと、生成のたびのランダム導出。
//
// 出し分ける軸: 髪型・審美観コード・体型・メガネ。年齢・外見表現・職業は persona 由来で spec から与える。
// 向き・ポーズは seed 選択で振れるので軸に持たない（プロンプトで指示するとスケールが崩れると確認済み）。
// personaId から固定せずランダムに引く：作り直す＝今の見た目が気に入らない、なので毎回別の見た目にする。
//
// 髪型は「スタイル名の固定リスト」ではなく、階層B型で組み立てる（設計書 v4 系）:
//   長さ → スタイリング状態（おろし/まとめ）→ [おろし] 前髪・シルエット・質感 / [まとめ] まとめ方
// 各ステップは前ステップに依存した有効肢だけを提示する（触覚・カーテンバング・巻き・ウェーブは長さが要るので
// 短い髪には出さない＝あご下＝B 以上、フェイスフレーミングは M 以上 等、視覚的に成立する条件を検証として
// コード化。これを緩めると「ベリーショートなのに全体巻き」等の矛盾指示になり、モデルが長い方へ寄せて短髪が
// 出なくなる）。アンコンシャスバイアスを避けるため、年齢・性別で長さや
// スタイルをハード除外しない：らしさは「出やすさの相対重み（基準1.0・未指定は1.0、大きいほど出やすい）」で
// 連続的に表現する（0.7・1.3 など任意の正の数で細かく制御できる。重みが正なら消えない）。
// ハード制約は最小限（下記 allowTie）。年齢は色でなくシルエットで出す前提（白髪等の描画は avatar-prompt）。

import { pickRandom, type Generation, type Presentation } from './avatar-seeds.js';

/** 1個体分の可変軸の値。生成のたびにランダムに導出される。 */
export interface Variation {
	hair: string;
	/** 審美観コードの英語キーワード（プロンプトに添付するだけ。パラメータ選択には影響しない）。「なし」は null。 */
	aestheticKeyword: string | null;
	body: string;
	glasses: boolean;
	glassesShape: string;
	glassesRim: string;
}

// ==========================================================================================
// 髪型（階層B型）
// ==========================================================================================

/** 長さ（第1軸）。VS=ベリーショート 〜 L=ロング。 */
const LENGTHS = ['VS', 'S', 'B', 'M', 'SL', 'L'] as const;
type Length = (typeof LENGTHS)[number];

const LENGTH_LABEL: Record<Length, string> = {
	VS: 'ベリーショート（耳より短い・刈り込み感）',
	S: 'ショート（耳〜えりあし）',
	B: 'ボブ（えりあし〜あご）',
	M: 'ミディアム（あご〜肩）',
	SL: 'セミロング（肩〜胸）',
	L: 'ロング（胸以下）'
};

type Styling = 'down' | 'tied';

/**
 * 出やすさの相対重み（外見表現ごと）。基準 1.0、未指定は 1.0。大きいほど出やすい（0.5で約半分、1.5で約1.5倍）。
 * 同ステップ内の有効肢の合計で正規化されるので、絶対値でなく肢どうしの比だけが効く。
 * 任意の正の数を取れる（1.3・0.7 など細かい制御も可）。
 */
type Weight = Partial<Record<Presentation, number>>;

/**
 * 髪型の選択肢の共通形。lengths＝その選択肢が視覚的に成立する長さ（ハード検証）。
 * needsHairline＝額に毛が垂れることを前提とする肢。生え際が後退・消失した毛量（Density.noHairline）とは
 * 両立しないので除外する（許すと「禿げているのに前髪だけある」矛盾した指示になる）。
 */
interface Option {
	name: string;
	lengths: readonly Length[];
	w?: Weight;
	needsHairline?: boolean;
}

// Step 1: 長さの重み。
// 長さの重み。男性は短い側から長い側へなだらかに減らし（長め寄りの偏りを補正）、女性は逆に長い側を厚く、
// 中性（未指定）はフラット（1.0）。値は相対重みなので、ここを 0.1 刻みで動かせば分布を細かく調整できる。
const LENGTH_WEIGHT: Record<Length, Weight> = {
	VS: { feminine: 0.7, masculine: 1.1, neutral: 0.8 },
	S: { feminine: 1.0, masculine: 1.1, neutral: 0.8 },
	B: { masculine: 1.1 },
	M: { feminine: 1.4, masculine: 0.09 },
	SL: { feminine: 1.4, masculine: 0.05 },
	L: { feminine: 1.4, masculine: 0.04 }
};

// Step 2: スタイリング状態。まとめは B 以上でのみ成立（VS/S は常におろし）。
const TIED_LENGTHS: readonly Length[] = ['B', 'M', 'SL', 'L'];
const STYLING_WEIGHT: Record<Styling, Weight> = {
	down: { masculine: 1.5 },
	tied: { feminine: 1.5, masculine: 0.15 } // 男性のまとめ髪は全体で約5%（結ぶ人はレア。全種類を一律に下げる）
};

// Step 3A: 前髪（おろし時）。触覚とカーテンバングは長い前髪を顔まわりに垂らすため B 以上でのみ成立
// （ベリーショート/ショートに付けると「短いのに長い前髪」で矛盾し、短髪が出なくなる）。
const NO_BANGS = '前髪なし（額出し）';
const BANGS: readonly Option[] = [
	{ name: NO_BANGS, lengths: LENGTHS, w: { masculine: 1.5 } },
	{ name: 'パッツン（直線的な前髪）', lengths: LENGTHS, w: { feminine: 1.5 }, needsHairline: true },
	{
		name: 'シースルー/カーテンバング',
		lengths: ['B', 'M', 'SL', 'L'],
		w: { feminine: 1.5, neutral: 1.5 },
		needsHairline: true
	},
	{ name: '流し前髪（サイドへ流す）', lengths: LENGTHS, w: { masculine: 1.5 }, needsHairline: true },
	{
		name: '触覚（顔まわりに長い束）',
		lengths: ['B', 'M', 'SL', 'L'],
		w: { feminine: 1.5, masculine: 0.5 },
		needsHairline: true
	}
];

// Step 4A: シルエット（おろし時）。カール/パーマは質感を内包するので質感ステップを飛ばす。
interface Silhouette extends Option {
	curl?: boolean;
}
const SILHOUETTES: readonly Silhouette[] = [
	{ name: 'クリーン（タイト・一枚岩）', lengths: LENGTHS, w: { masculine: 1.5 } },
	// マッシュは額を覆う丸い前髪が形の定義そのものなので、生え際が後退した毛量とは両立しない。
	{
		name: 'マッシュ（丸みシルエット）',
		lengths: ['S', 'B', 'M'],
		w: { masculine: 1.5 },
		needsHairline: true
	},
	{
		name: 'ウルフ（段差レイヤー・毛先はね）',
		lengths: ['S', 'B', 'M', 'SL', 'L'],
		w: { masculine: 0.6 } // 女性・中性は基準1.0。男性だけ外はねを控えめに。
	},
	{ name: 'スラント（前下がり・非対称）', lengths: ['B', 'M', 'SL', 'L'], w: { feminine: 1.5 } },
	{
		name: 'テクスチャー（無造作・動き重視）',
		lengths: ['VS', 'S', 'B', 'M'],
		w: { masculine: 1.5 }
	},
	// 男性寄りの短髪スタイル。サイドを刈り上げるので短い長さでのみ成立。女性は低め（無くはない）。
	{
		name: '刈り上げ/フェード（サイドを刈り上げ、トップに高さを残す）',
		lengths: ['VS', 'S', 'B'],
		w: { masculine: 0.8, feminine: 0.3 }
	},
	{
		name: 'ツーブロック/アンダーカット（サイド刈り上げ×トップ長め）',
		lengths: ['S', 'B', 'M'],
		w: { masculine: 1.3, feminine: 0.4 }
	},
	{
		name: 'フェイスフレーミング（顔まわりのみレイヤー）',
		lengths: ['M', 'SL', 'L'],
		w: { feminine: 1.5, masculine: 0.5 }
	},
	// 全体巻きは巻きが視覚的に成立する長さ（あご下＝B 以上）が要る。VS/S に付けると長い方へ寄る。
	{
		name: 'カール/パーマ（全体巻き）',
		lengths: ['B', 'M', 'SL', 'L'],
		w: { feminine: 1.5, masculine: 0.5 },
		curl: true
	}
];

// Step 5A: 質感（おろし時・カール以外）。ウェーブは波が視覚的に成立する長さ（あご下＝B 以上）が要る。
// VS/S は短くて波が出ないため質感はストレートのみ（波を付けると長い方へ寄って短髪が出なくなる）。
const TEXTURES: readonly Option[] = [
	{ name: 'ストレート', lengths: LENGTHS, w: { masculine: 1.5 } },
	{ name: 'ゆるウェーブ', lengths: ['B', 'M', 'SL', 'L'], w: { feminine: 1.5, masculine: 0.6 } }
];

// Step 3B: まとめ方（まとめ時）。noMaleChild / twintail はハード制約（allowTie で除外）。
interface Tie extends Option {
	noMaleChild?: boolean;
	twintail?: boolean;
}
const TIE_METHODS: readonly Tie[] = [
	{ name: 'ハーフアップ', lengths: ['B', 'M', 'SL', 'L'], w: { feminine: 1.5 } },
	{ name: 'ローポニーテール', lengths: ['B', 'M', 'SL', 'L'], w: { masculine: 1.5 } },
	{ name: 'ハイポニーテール', lengths: ['M', 'SL', 'L'], w: { feminine: 1.5 } },
	{ name: 'お団子（低め）', lengths: ['M', 'SL', 'L'], w: { feminine: 1.5 }, noMaleChild: true },
	{ name: 'お団子（高め）', lengths: ['M', 'SL', 'L'], w: { masculine: 0.5 }, noMaleChild: true },
	{ name: 'ツインテール', lengths: ['M'], w: { feminine: 1.5 }, twintail: true }
];

// 特定の長さで視覚差・量の都合から出現を控えめにする係数（基準重みへ乗算する）。
const LENGTH_FACTOR: ReadonlyArray<{ name: string; length: Length; factor: number }> = [
	{ name: 'お団子（高め）', length: 'M', factor: 0.5 }
];

// 年齢で特定の選択肢を増減する係数（加齢で変わりやすい髪の質）。基準重みへ乗算する。長さ（＝骨格）も
// シルエットの「形」も年齢で歪めない：スタイルのトレンド感は Step0（審美観コード）で表す。ここに置くのは
// 前髪・質感など加齢で自然に変わる要素に限る。
const AGE_FACTOR: ReadonlyArray<{ name: string; generation: Generation; factor: number }> = [
	// 若年: 前髪ありを増やす（前髪なし＝額出しを減らす）
	{ name: NO_BANGS, generation: 'child', factor: 0.5 },
	{ name: NO_BANGS, generation: 'young', factor: 0.5 },
	// 若年: ウェーブ・全体巻きを減らしストレート寄りに（波・パーマは中年以降の印象）
	{ name: 'ゆるウェーブ', generation: 'child', factor: 0.4 },
	{ name: 'ゆるウェーブ', generation: 'young', factor: 0.4 },
	{ name: 'カール/パーマ（全体巻き）', generation: 'young', factor: 0.6 }
];

const weightFor = (w: Weight | undefined, presentation: Presentation): number =>
	w?.[presentation] ?? 1;

/** その選択肢の重み。基準重みに、長さ別（LENGTH_FACTOR）と年齢別（AGE_FACTOR）の係数を乗じる。 */
const optionWeight = (
	opt: Option,
	length: Length,
	generation: Generation,
	presentation: Presentation
): number => {
	const lenFactor =
		LENGTH_FACTOR.find((f) => f.name === opt.name && f.length === length)?.factor ?? 1;
	const ageFactor =
		AGE_FACTOR.find((f) => f.name === opt.name && f.generation === generation)?.factor ?? 1;
	return weightFor(opt.w, presentation) * lenFactor * ageFactor;
};

/** 重みに比例してランダムに1つ選ぶ。合計が0にならない前提（有効肢は常に1つ以上ある）。 */
const weightedPick = <T>(items: readonly T[], weight: (t: T) => number): T => {
	const total = items.reduce((sum, it) => sum + weight(it), 0);
	let r = Math.random() * total;
	for (const it of items) {
		r -= weight(it);
		if (r < 0) return it;
	}
	return items[items.length - 1];
};

const validAt = (opt: { lengths: readonly Length[] }, length: Length): boolean =>
	opt.lengths.includes(length);

/**
 * まとめ方のハード制約（バイアスフリー方針の最小限の除外）:
 * - お団子は male の child では使わない。
 * - ツインテールは feminine の child/young でのみ使う。
 */
const allowTie = (tie: Tie, generation: Generation, presentation: Presentation): boolean => {
	if (tie.noMaleChild && presentation === 'masculine' && generation === 'child') return false;
	if (
		tie.twintail &&
		!(presentation === 'feminine' && (generation === 'child' || generation === 'young'))
	)
		return false;
	return true;
};

// ==========================================================================================
// 加齢による見た目（髪色・生え際/毛量）。年齢＝generation で確率が変わる唯一の見た目軸。
// 顔を描かないシルエットなので、加齢は「髪色（白髪）」と「生え際・毛量（後退・薄毛）」で表す。
// ==========================================================================================

/** 世代ごとの重み（未指定は 0＝出さない）。加齢特徴は年齢で確率が変わるのでこの型で持つ。 */
type GenWeight = Partial<Record<Generation, number>>;
const genWeightFor = (w: GenWeight, generation: Generation): number => w[generation] ?? 0;

/** 髪色。若年は黒、加齢で白髪/グレイ。desc が null（黒髪）なら記述を足さない。 */
interface HairColor {
	name: string;
	desc: string | null;
	w: GenWeight;
}
const HAIR_COLORS: readonly HairColor[] = [
	{ name: '黒髪', desc: null, w: { child: 1, young: 1, middle: 1, senior: 0.4, elder: 0.15 } },
	{
		name: '白髪交じり',
		desc: '髪には白髪が混じる（黒く塗ったうえに白い細い筋で表す）',
		w: { middle: 0.12, senior: 0.7, elder: 0.6 }
	},
	{
		name: 'グレイ／白髪',
		desc: '髪はグレイ〜白髪（黒地に白い細い筋を多めに入れて表す）',
		w: { middle: 0.02, senior: 0.35, elder: 0.9 }
	}
];

/**
 * 生え際・毛量。加齢（と男性型脱毛）で後退・薄毛が出る。desc が null（ふさふさ）なら記述を足さない。
 * 薄毛の度合いは髪の長さと両立する範囲に限る（禿げ気味は短い髪でだけ）。女性は男性型の生え際後退は
 * 出さず（w 空）、高齢で全体の毛量減がわずかに出る程度にする。年齢で長さは狭めない方針は保つ。
 */
interface Density {
	name: string;
	desc: string | null;
	lengths: readonly Length[];
	w: Record<Presentation, GenWeight>;
	/** 生え際が後退・消失していて額に毛が無い。needsHairline の肢（前髪あり・マッシュ）を除外する。 */
	noHairline?: boolean;
}
const DENSITIES: readonly Density[] = [
	{
		name: '毛量豊か',
		desc: '毛量が多くハリ・コシがあり若々しい',
		lengths: LENGTHS,
		w: {
			masculine: { child: 0.9, young: 0.8 },
			feminine: { child: 0.9, young: 0.8 },
			neutral: { child: 0.9, young: 0.8 }
		}
	},
	{
		name: 'ふさふさ',
		desc: null,
		lengths: LENGTHS,
		w: {
			masculine: { child: 1, young: 1, middle: 1, senior: 0.8, elder: 0.6 },
			feminine: { child: 1, young: 1, middle: 1, senior: 1, elder: 1 },
			neutral: { child: 1, young: 1, middle: 1, senior: 0.9, elder: 0.85 }
		}
	},
	{
		name: '生え際後退',
		desc: '生え際が後退している',
		lengths: LENGTHS,
		w: { masculine: { middle: 0.25, senior: 0.9, elder: 1.1 }, feminine: {}, neutral: { senior: 0.25, elder: 0.4 } },
		noHairline: true
	},
	{
		name: '頭頂部の薄毛',
		desc: '頭頂部の毛量が減って地肌がのぞく',
		lengths: ['VS', 'S', 'B', 'M'],
		w: { masculine: { senior: 0.5, elder: 0.9 }, feminine: { elder: 0.12 }, neutral: { elder: 0.25 } }
	},
	{
		name: '著しい薄毛',
		desc: 'かなり薄毛で地肌が目立つ（サイドと後頭部にわずかに残る程度）',
		lengths: ['VS', 'S'],
		w: { masculine: { senior: 0.3, elder: 0.8 }, feminine: {}, neutral: { elder: 0.2 } },
		noHairline: true
	}
];

const descOf = (arr: readonly { name: string; desc: string | null }[], name: string): string | null =>
	arr.find((x) => x.name === name)?.desc ?? null;

/**
 * その毛量と両立する肢か（ハード制約）。生え際が無い毛量に前髪あり・マッシュを許すと
 * 「禿げているのに前髪だけある」矛盾になるため除外する。
 */
const fitsDensity = (opt: Option, density: string): boolean =>
	!opt.needsHairline || !DENSITIES.find((d) => d.name === density)?.noHairline;

/** 組み立てた髪型の構造。おろしなら bangs/silhouette(/texture)、まとめなら tie を持つ。 */
export interface HairChoice {
	length: Length;
	styling: Styling;
	bangs?: string;
	silhouette?: string;
	texture?: string;
	tie?: string;
	/** 髪色（加齢で白髪等）。名前で持ち、記述は describeHair が引く。 */
	color: string;
	/** 生え際・毛量（加齢で後退・薄毛）。 */
	density: string;
}

/** 階層B型で髪型を1つ組み立てる。各ステップは有効肢のみを外見表現の重みで引く。 */
export const composeHair = (generation: Generation, presentation: Presentation): HairChoice => {
	const length = weightedPick(LENGTHS, (l) => weightFor(LENGTH_WEIGHT[l], presentation));

	// 加齢軸。髪色は長さに依らず、生え際・毛量は薄毛が長さと両立する範囲に限る。
	const color = weightedPick(HAIR_COLORS, (c) => genWeightFor(c.w, generation)).name;
	const density = weightedPick(
		DENSITIES.filter((d) => validAt(d, length)),
		(d) => genWeightFor(d.w[presentation], generation)
	).name;

	const stylings: readonly Styling[] = TIED_LENGTHS.includes(length) ? ['down', 'tied'] : ['down'];
	const styling = weightedPick(stylings, (s) => weightFor(STYLING_WEIGHT[s], presentation));

	if (styling === 'tied') {
		const ties = TIE_METHODS.filter(
			(t) => validAt(t, length) && allowTie(t, generation, presentation)
		);
		const tie = weightedPick(ties, (t) => optionWeight(t, length, generation, presentation));
		return { length, styling, tie: tie.name, color, density };
	}

	const bangs = weightedPick(
		BANGS.filter((b) => validAt(b, length) && fitsDensity(b, density)),
		(b) => optionWeight(b, length, generation, presentation)
	);
	const silhouette = weightedPick(
		SILHOUETTES.filter((s) => validAt(s, length) && fitsDensity(s, density)),
		(s) => optionWeight(s, length, generation, presentation)
	);
	const choice: HairChoice = {
		length,
		styling,
		bangs: bangs.name,
		silhouette: silhouette.name,
		color,
		density
	};
	if (!silhouette.curl) {
		const texture = weightedPick(
			TEXTURES.filter((t) => validAt(t, length)),
			(t) => optionWeight(t, length, generation, presentation)
		);
		choice.texture = texture.name;
	}
	return choice;
};

/** 組み立てた髪型を、プロンプトに載せる日本語の一文へ整形する。加齢の記述は非既定のときだけ足す。 */
export const describeHair = (c: HairChoice): string => {
	const base =
		c.styling === 'tied'
			? `長さは${LENGTH_LABEL[c.length]}。${c.tie}にまとめる。`
			: `長さは${LENGTH_LABEL[c.length]}でおろす。前髪は${c.bangs}。シルエットは${c.silhouette}。` +
				(c.texture ? `毛の質感は${c.texture}。` : '');
	const density = descOf(DENSITIES, c.density);
	const color = descOf(HAIR_COLORS, c.color);
	return base + (density ? `${density}。` : '') + (color ? `${color}。` : '');
};

// ==========================================================================================
// 審美観コード（Step 0）
//
// パラメータ選択（長さ・シルエット等）には影響させず、選ばれた英語キーワードを生成プロンプトへ添付する
// だけ。外見表現＋年齢（generation）に応じた有効コードから引く（「なし」＝null を一定割合含めることで
// 審美観の偏りを避ける）。年齢で出し分ける：トレンド系は若年、落ち着いた系は年齢を問わない。
// ==========================================================================================

interface Aesthetic {
	keyword: string | null;
	presentations: readonly Presentation[];
	/** 有効な世代。未指定＝全年齢。トレンド系だけ若年に絞る。 */
	generations?: readonly Generation[];
	/** トレンド系（若年で出やすさを強める）。 */
	trendy?: boolean;
}
const ALL_PRESENTATIONS: readonly Presentation[] = ['masculine', 'feminine', 'neutral'];
const YOUNG: readonly Generation[] = ['child', 'young'];
const ADULT: readonly Generation[] = ['middle', 'senior', 'elder'];
const AESTHETIC_CODES: readonly Aesthetic[] = [
	{ keyword: 'ulzzang style', presentations: ['feminine', 'neutral'], generations: ['young'], trendy: true },
	{ keyword: 'Y2K style', presentations: ALL_PRESENTATIONS, generations: YOUNG, trendy: true },
	{ keyword: 'street fashion style', presentations: ALL_PRESENTATIONS, generations: ['young', 'middle'], trendy: true },
	{ keyword: 'French casual style', presentations: ALL_PRESENTATIONS },
	{ keyword: 'clean minimal style', presentations: ALL_PRESENTATIONS },
	{ keyword: 'neutral cool style', presentations: ALL_PRESENTATIONS },
	{ keyword: 'barber shop style', presentations: ['masculine', 'neutral'], generations: ADULT },
	{ keyword: null, presentations: ALL_PRESENTATIONS }
];

/**
 * 審美観コードを1つ引く。外見表現＋年齢に有効なコードのみが対象。「なし」は null を返す。
 * スタイルのトレンド感はここで表す：若年はトレンド系を強め（×2.2）、「なし」を減らして（×0.4）
 * トレンドを出しやすくする。中年以降はトレンド系がそもそも有効でないので通常の一様選択になる。
 */
export const selectAesthetic = (
	generation: Generation,
	presentation: Presentation
): string | null => {
	const valid = AESTHETIC_CODES.filter(
		(a) =>
			a.presentations.includes(presentation) &&
			(!a.generations || a.generations.includes(generation))
	);
	const young = generation === 'child' || generation === 'young';
	return weightedPick(valid, (a) =>
		a.keyword === null ? (young ? 0.4 : 1) : a.trendy && young ? 2.2 : 1
	).keyword;
};

// ==========================================================================================
// 体型・メガネ
// ==========================================================================================

/** 体型（頭身・肩幅の骨格）。年齢は皺でなくこのシルエットで表す前提の語彙。 */
export const BODY_CATALOG = ['華奢', '標準体型', 'がっしり', 'ふくよか'] as const;

/** メガネ着用率。 */
export const GLASSES_PROBABILITY = 0.25;

// メガネは「縁の太さ＋入り方」と「形状」を独立変数として別々に振り、プロンプトで合成する。
// こうすると 太い×スクエア / 細い上だけ×丸 など組み合わせで幅が出る（1軸に混ぜると固定化して偏る）。
// ハーフリム（上だけ/下だけ）は太い実物が無いので「細い」を焼き込む。太さは全体軸にせずこの語彙で縛る。
export const GLASSES_RIM_CATALOG = [
	'太いフルリム',
	'細いフルリム',
	'細い縁が上側だけのブロウライン（下側は縁なし）',
	'細い縁が下側だけのアンダーリム（上側は縁なし）'
] as const;

export const GLASSES_SHAPE_CATALOG = [
	'丸',
	'オーバル',
	'スクエア',
	'ウェリントン型',
	'ボストン型',
	'ティアドロップ型'
] as const;

/**
 * 各軸を生成のたびにランダムに導出する。軸ごとに独立に引くので、メガネ有無と縁様式が連動しない。
 * 髪型は階層B型で組み立て（composeHair）、審美観コードは外見表現に応じて引く（selectAesthetic）。
 */
export const resolveVariation = (
	generation: Generation,
	presentation: Presentation
): Variation => ({
	hair: describeHair(composeHair(generation, presentation)),
	aestheticKeyword: selectAesthetic(generation, presentation),
	body: pickRandom(BODY_CATALOG),
	glasses: Math.random() < GLASSES_PROBABILITY,
	glassesShape: pickRandom(GLASSES_SHAPE_CATALOG),
	glassesRim: pickRandom(GLASSES_RIM_CATALOG)
});
