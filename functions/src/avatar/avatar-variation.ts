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

/** 髪型の選択肢の共通形。lengths＝その選択肢が視覚的に成立する長さ（ハード検証）。 */
interface Option {
	name: string;
	lengths: readonly Length[];
	w?: Weight;
}

// Step 1: 長さの重み。
// 長さの重み。男性は短い側から長い側へなだらかに減らし（長め寄りの偏りを補正）、女性は逆に長い側を厚く、
// 中性（未指定）はフラット（1.0）。値は相対重みなので、ここを 0.1 刻みで動かせば分布を細かく調整できる。
const LENGTH_WEIGHT: Record<Length, Weight> = {
	VS: { feminine: 0.7, masculine: 1.1, neutral: 0.8 },
	S: { feminine: 1.0, masculine: 1.1, neutral: 0.8 },
	B: { masculine: 1.1 },
	M: { feminine: 1.4, masculine: 0.9 },
	SL: { feminine: 1.4, masculine: 0.6 },
	L: { feminine: 1.4, masculine: 0.5 }
};

// Step 2: スタイリング状態。まとめは B 以上でのみ成立（VS/S は常におろし）。
const TIED_LENGTHS: readonly Length[] = ['B', 'M', 'SL', 'L'];
const STYLING_WEIGHT: Record<Styling, Weight> = {
	down: { masculine: 1.5 },
	tied: { feminine: 1.5 }
};

// Step 3A: 前髪（おろし時）。触覚とカーテンバングは長い前髪を顔まわりに垂らすため B 以上でのみ成立
// （ベリーショート/ショートに付けると「短いのに長い前髪」で矛盾し、短髪が出なくなる）。
const BANGS: readonly Option[] = [
	{ name: '前髪なし（額出し）', lengths: LENGTHS, w: { masculine: 1.5 } },
	{ name: 'パッツン（直線的な前髪）', lengths: LENGTHS, w: { feminine: 1.5 } },
	{
		name: 'シースルー/カーテンバング',
		lengths: ['B', 'M', 'SL', 'L'],
		w: { feminine: 1.5, neutral: 1.5 }
	},
	{ name: '流し前髪（サイドへ流す）', lengths: LENGTHS, w: { masculine: 1.5 } },
	{
		name: '触覚（顔まわりに長い束）',
		lengths: ['B', 'M', 'SL', 'L'],
		w: { feminine: 1.5, masculine: 0.5 }
	}
];

// Step 4A: シルエット（おろし時）。カール/パーマは質感を内包するので質感ステップを飛ばす。
interface Silhouette extends Option {
	curl?: boolean;
}
const SILHOUETTES: readonly Silhouette[] = [
	{ name: 'クリーン（タイト・一枚岩）', lengths: LENGTHS, w: { masculine: 1.5 } },
	{ name: 'マッシュ（丸みシルエット）', lengths: ['S', 'B', 'M'], w: { masculine: 1.5 } },
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

const weightFor = (w: Weight | undefined, presentation: Presentation): number =>
	w?.[presentation] ?? 1;

/** その長さでの選択肢の重み。基準重みに、長さ別の控えめ係数（あれば）を乗じる。 */
const optionWeight = (opt: Option, length: Length, presentation: Presentation): number => {
	const factor = LENGTH_FACTOR.find((f) => f.name === opt.name && f.length === length)?.factor ?? 1;
	return weightFor(opt.w, presentation) * factor;
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

const validAt = (opt: Option, length: Length): boolean => opt.lengths.includes(length);

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

/** 組み立てた髪型の構造。おろしなら bangs/silhouette(/texture)、まとめなら tie を持つ。 */
export interface HairChoice {
	length: Length;
	styling: Styling;
	bangs?: string;
	silhouette?: string;
	texture?: string;
	tie?: string;
}

/** 階層B型で髪型を1つ組み立てる。各ステップは有効肢のみを外見表現の重みで引く。 */
export const composeHair = (generation: Generation, presentation: Presentation): HairChoice => {
	const length = weightedPick(LENGTHS, (l) => weightFor(LENGTH_WEIGHT[l], presentation));

	const stylings: readonly Styling[] = TIED_LENGTHS.includes(length) ? ['down', 'tied'] : ['down'];
	const styling = weightedPick(stylings, (s) => weightFor(STYLING_WEIGHT[s], presentation));

	if (styling === 'tied') {
		const ties = TIE_METHODS.filter(
			(t) => validAt(t, length) && allowTie(t, generation, presentation)
		);
		const tie = weightedPick(ties, (t) => optionWeight(t, length, presentation));
		return { length, styling, tie: tie.name };
	}

	const bangs = weightedPick(
		BANGS.filter((b) => validAt(b, length)),
		(b) => optionWeight(b, length, presentation)
	);
	const silhouette = weightedPick(
		SILHOUETTES.filter((s) => validAt(s, length)),
		(s) => optionWeight(s, length, presentation)
	);
	const choice: HairChoice = { length, styling, bangs: bangs.name, silhouette: silhouette.name };
	if (!silhouette.curl) {
		const texture = weightedPick(
			TEXTURES.filter((t) => validAt(t, length)),
			(t) => optionWeight(t, length, presentation)
		);
		choice.texture = texture.name;
	}
	return choice;
};

/** 組み立てた髪型を、プロンプトに載せる日本語の一文へ整形する。 */
export const describeHair = (c: HairChoice): string =>
	c.styling === 'tied'
		? `長さは${LENGTH_LABEL[c.length]}。${c.tie}にまとめる。`
		: `長さは${LENGTH_LABEL[c.length]}でおろす。前髪は${c.bangs}。シルエットは${c.silhouette}。` +
			(c.texture ? `毛の質感は${c.texture}。` : '');

// ==========================================================================================
// 審美観コード（Step 0）
//
// パラメータ選択（長さ・シルエット等）には影響させず、選ばれた英語キーワードを生成プロンプトへ添付する
// だけ。外見表現に応じた有効コードから引く（「なし」＝null を一定割合含めることで審美観の偏りを避ける）。
// ==========================================================================================

interface Aesthetic {
	keyword: string | null;
	presentations: readonly Presentation[];
}
const ALL_PRESENTATIONS: readonly Presentation[] = ['masculine', 'feminine', 'neutral'];
const AESTHETIC_CODES: readonly Aesthetic[] = [
	{ keyword: 'ulzzang style', presentations: ['feminine', 'neutral'] },
	{ keyword: 'French casual style', presentations: ALL_PRESENTATIONS },
	{ keyword: 'Y2K style', presentations: ALL_PRESENTATIONS },
	{ keyword: 'neutral cool style', presentations: ALL_PRESENTATIONS },
	{ keyword: 'clean minimal style', presentations: ALL_PRESENTATIONS },
	{ keyword: 'street fashion style', presentations: ALL_PRESENTATIONS },
	{ keyword: 'barber shop style', presentations: ['masculine', 'neutral'] },
	{ keyword: null, presentations: ALL_PRESENTATIONS }
];

/** 審美観コードを1つ引く。外見表現に有効なコードのみが対象。「なし」は null を返す。 */
export const selectAesthetic = (presentation: Presentation): string | null =>
	pickRandom(AESTHETIC_CODES.filter((a) => a.presentations.includes(presentation))).keyword;

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
	aestheticKeyword: selectAesthetic(presentation),
	body: pickRandom(BODY_CATALOG),
	glasses: Math.random() < GLASSES_PROBABILITY,
	glassesShape: pickRandom(GLASSES_SHAPE_CATALOG),
	glassesRim: pickRandom(GLASSES_RIM_CATALOG)
});
