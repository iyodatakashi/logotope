// 可変軸のカタログと、生成のたびのランダム導出。
//
// 出し分ける軸: 髪型・体型・メガネ。年齢・外見表現・職業は persona 由来で spec から与える。
// 向き・ポーズは seed 選択で振れるので軸に持たない（プロンプトで指示するとスケールが崩れると確認済み）。
// personaId から固定せずランダムに引く：作り直す＝今の見た目が気に入らない、なので毎回別の見た目にする。
// カタログはすべて追記で拡張できる。要素数を前提にした処理や全組み合わせの列挙は書かない（Req 3.6）。

import { pickRandom, type Generation, type SeedPresentation } from './avatar-seeds.js';

/** 1個体分の可変軸の値。生成のたびにランダムに導出される。 */
export interface Variation {
	hair: string;
	body: string;
	glasses: boolean;
	glassesShape: string;
	glassesRim: string;
}

// 髪型は世代×外見表現で語彙が変わるため、その2軸で引く。若年ほど選択肢が多く、高齢は薄毛・白髪を含む。
// 白髪は色でなくシルエット・生え際で年齢を出す前提の語彙にする（描画様式は avatar-prompt が担う）。
export const HAIR_CATALOG: Record<Generation, Record<SeedPresentation, string[]>> = {
	child: {
		masculine: ['ベリーショート', '刈り上げショート', 'マッシュ', 'ソフトモヒカン', 'くせ毛マッシュ', '坊主'],
		feminine: ['ショートボブ', 'おかっぱ', 'ツインテール', 'ポニーテール', '三つ編み', 'お団子']
	},
	young: {
		masculine: ['マッシュ', 'ツーブロック', 'センターパート', 'ショートレイヤー', 'パーマショート', 'ウルフカット', '七三'],
		feminine: ['ロングストレート', 'セミロング', 'ミディアムレイヤー', 'ボブ', 'ポニーテール', 'お団子アップ', 'ショートカット']
	},
	middle: {
		masculine: ['ビジネスショート', 'ツーブロックショート', '七三', 'オールバック', 'マッシュショート', 'ナチュラルショート'],
		feminine: ['セミロング', 'ミディアムボブ', 'レイヤーロング', 'ワンレングスボブ', 'ハーフアップ', 'ショートボブ']
	},
	senior: {
		masculine: ['白髪交じりショート', '七三', '刈り上げ', '額の後退気味ショート', 'オールバック', 'ナチュラルショート'],
		feminine: ['ショートレイヤー', 'ミディアムボブ', 'ゆるパーマショート', 'ワンレンボブ', 'まとめ髪', 'ふんわりショート']
	},
	elder: {
		masculine: ['白髪短髪', '頭頂部薄毛', 'ほぼ禿頭（サイドのみ）', '白髪オールバック', '坊主'],
		feminine: ['ふんわりショートパーマ', 'グレイヘアショート', 'ショートボブ', '薄毛気味ショート', 'まとめ髪']
	}
};

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
 * 各軸を生成のたびにランダムに選ぶ。軸ごとに独立に引くので、メガネ有無と縁様式が連動しない。
 * androgynous には seed が無く呼び出し側が selectSeed の null で先に分岐するため、外見表現は
 * SeedPresentation に限る。
 */
export const resolveVariation = (
	generation: Generation,
	presentation: SeedPresentation
): Variation => ({
	hair: pickRandom(HAIR_CATALOG[generation][presentation]),
	body: pickRandom(BODY_CATALOG),
	glasses: Math.random() < GLASSES_PROBABILITY,
	glassesShape: pickRandom(GLASSES_SHAPE_CATALOG),
	glassesRim: pickRandom(GLASSES_RIM_CATALOG)
});
