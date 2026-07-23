// 可変軸のカタログと、生成のたびのランダム導出。
//
// 出し分ける軸: 髪型・審美観コード・体型・メガネ。年齢・外見表現・職業は persona 由来で spec から与える。
// 向き・ポーズは seed 選択で振れるので軸に持たない（プロンプトで指示するとスケールが崩れると確認済み）。
// personaId から固定せずランダムに引く：作り直す＝今の見た目が気に入らない、なので毎回別の見た目にする。
//
// 髪型は「スタイル名の固定リスト」ではなく、階層B型で組み立てる（設計書 v4 系）:
//   長さ → スタイリング状態（おろし/まとめ）→ [おろし] 前髪・シルエット・質感 / [まとめ] まとめ方
// 各ステップは前ステップに依存した有効肢だけを提示する（触覚は B 以上、フェイスフレーミングは M 以上 等、
// 視覚的に成立する条件を検証としてコード化）。アンコンシャスバイアスを避けるため、年齢・性別で長さや
// スタイルをハード除外しない：らしさは「出やすさ（重み ◎3/○2/△1、既定 ○2）」で表現し、△でも引ける。
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

/** 出やすさの重み。未指定の外見表現は既定 2（○）。◎=3 / ○=2 / △=1。 */
type Weight = Partial<Record<Presentation, number>>;

/** 髪型の選択肢の共通形。lengths＝その選択肢が視覚的に成立する長さ（ハード検証）。 */
interface Option {
	name: string;
	lengths: readonly Length[];
	w?: Weight;
}

// Step 1: 長さの重み。
const LENGTH_WEIGHT: Record<Length, Weight> = {
	VS: { feminine: 1, masculine: 3 },
	S: { masculine: 3 },
	B: {},
	M: { feminine: 3 },
	SL: { feminine: 3 },
	L: { feminine: 3, masculine: 1 }
};

// Step 2: スタイリング状態。まとめは B 以上でのみ成立（VS/S は常におろし）。
const TIED_LENGTHS: readonly Length[] = ['B', 'M', 'SL', 'L'];
const STYLING_WEIGHT: Record<Styling, Weight> = {
	down: { masculine: 3 },
	tied: { feminine: 3 }
};

// Step 3A: 前髪（おろし時）。触覚は束を垂らすため B 以上でのみ成立。
const BANGS: readonly Option[] = [
	{ name: '前髪なし（額出し）', lengths: LENGTHS, w: { masculine: 3 } },
	{ name: 'パッツン（直線的な前髪）', lengths: LENGTHS, w: { feminine: 3 } },
	{ name: 'シースルー/カーテンバング', lengths: LENGTHS, w: { feminine: 3, androgynous: 3 } },
	{ name: '流し前髪（サイドへ流す）', lengths: LENGTHS, w: { masculine: 3 } },
	{ name: '触覚（顔まわりに長い束）', lengths: ['B', 'M', 'SL', 'L'], w: { feminine: 3, masculine: 1 } }
];

// Step 4A: シルエット（おろし時）。カール/パーマは質感を内包するので質感ステップを飛ばす。
interface Silhouette extends Option {
	curl?: boolean;
}
const SILHOUETTES: readonly Silhouette[] = [
	{ name: 'クリーン（タイト・一枚岩）', lengths: LENGTHS, w: { masculine: 3 } },
	{ name: 'マッシュ（丸みシルエット）', lengths: ['S', 'B', 'M'], w: { masculine: 3 } },
	{ name: 'ウルフ（段差レイヤー・毛先はね）', lengths: ['S', 'B', 'M', 'SL', 'L'], w: { androgynous: 3 } },
	{ name: 'スラント（前下がり・非対称）', lengths: ['B', 'M', 'SL', 'L'], w: { feminine: 3 } },
	{ name: 'テクスチャー（無造作・動き重視）', lengths: ['VS', 'S', 'B', 'M'], w: { masculine: 3 } },
	{ name: 'フェイスフレーミング（顔まわりのみレイヤー）', lengths: ['M', 'SL', 'L'], w: { feminine: 3, masculine: 1 } },
	{ name: 'カール/パーマ（全体巻き）', lengths: LENGTHS, w: { feminine: 3, masculine: 1 }, curl: true }
];

// Step 5A: 質感（おろし時・カール以外）。
const TEXTURES: readonly Option[] = [
	{ name: 'ストレート', lengths: LENGTHS, w: { masculine: 3 } },
	{ name: 'ゆるウェーブ', lengths: LENGTHS, w: { feminine: 3 } } // VS は下の LOW_WEIGHT_AT で △ に落とす
];

// Step 3B: まとめ方（まとめ時）。noMaleChild / twintail はハード制約（allowTie で除外）。
interface Tie extends Option {
	noMaleChild?: boolean;
	twintail?: boolean;
}
const TIE_METHODS: readonly Tie[] = [
	{ name: 'ハーフアップ', lengths: ['B', 'M', 'SL', 'L'], w: { feminine: 3 } },
	{ name: 'ローポニーテール', lengths: ['B', 'M', 'SL', 'L'], w: { masculine: 3 } },
	{ name: 'ハイポニーテール', lengths: ['M', 'SL', 'L'], w: { feminine: 3 } },
	{ name: 'お団子（低め）', lengths: ['M', 'SL', 'L'], w: { feminine: 3 }, noMaleChild: true },
	{ name: 'お団子（高め）', lengths: ['M', 'SL', 'L'], w: { masculine: 1 }, noMaleChild: true },
	{ name: 'ツインテール', lengths: ['M'], w: { feminine: 3 }, twintail: true }
];

// △：技術的には有効だが視覚差・量の都合で出現確率を下げる（外見表現に関わらず重み1）。
const LOW_WEIGHT_AT: ReadonlyArray<{ name: string; length: Length }> = [
	{ name: 'ゆるウェーブ', length: 'VS' },
	{ name: 'お団子（高め）', length: 'M' }
];

const weightFor = (w: Weight | undefined, presentation: Presentation): number =>
	w?.[presentation] ?? 2;

/** その長さでの選択肢の重み。△（LOW_WEIGHT_AT）に該当すれば外見表現によらず 1。 */
const optionWeight = (opt: Option, length: Length, presentation: Presentation): number =>
	LOW_WEIGHT_AT.some((o) => o.name === opt.name && o.length === length)
		? 1
		: weightFor(opt.w, presentation);

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
const ALL_PRESENTATIONS: readonly Presentation[] = ['masculine', 'feminine', 'androgynous'];
const AESTHETIC_CODES: readonly Aesthetic[] = [
	{ keyword: 'ulzzang style', presentations: ['feminine', 'androgynous'] },
	{ keyword: 'French casual style', presentations: ALL_PRESENTATIONS },
	{ keyword: 'Y2K style', presentations: ALL_PRESENTATIONS },
	{ keyword: 'androgynous cool style', presentations: ALL_PRESENTATIONS },
	{ keyword: 'clean minimal style', presentations: ALL_PRESENTATIONS },
	{ keyword: 'street fashion style', presentations: ALL_PRESENTATIONS },
	{ keyword: 'barber shop style', presentations: ['masculine', 'androgynous'] },
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
