// 可変軸のカタログと、(personaId, attempt) からの決定的導出。
//
// 出し分ける軸: 髪型・体型・ポーズ・アングル・メガネ。年齢・外見表現・職業は persona 由来で
// spec から与える（ここでは引かない）。バリエーションは AI の裁量任せにせず、この決定的導出で
// 明示的に固定する（Req 3.5）。
//
// **カタログはすべて追記で拡張できる。** 要素数を前提にした処理や全組み合わせの列挙は書かない
// （Req 3.6）。選択は毎回 (personaId, attempt) から pickDeterministic で再計算し、どこにも保存
// しないので、1件追記しても導出そのものは壊れない（既存 persona の見た目は変わりうるが、見た目は
// 同一性ではない。同一性キーは (personaId, attempt)）。

import {
	pickDeterministic,
	type Generation,
	type SeedPresentation
} from './avatar-seeds.js';

/** 1個体分の可変軸の値。すべて決定的に導出される。 */
export interface Variation {
	hair: string;
	body: string;
	pose: string;
	angle: string;
	glasses: boolean;
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

/** バストアップ内の上体の構え。表情は「真剣に話している」で固定するので、ここでは持たない。 */
export const POSE_CATALOG = [
	'肩をまっすぐ正面に向ける',
	'片肩をわずかに前に出す',
	'軽く胸を張る',
	'やや前傾で話す'
] as const;

/** カメラアングル。 */
export const ANGLE_CATALOG = ['正面', '斜め約30度'] as const;

// メガネの有無。true の割合＝配列中の true 数 / 全体（現状 1/4）。割合の調整は要素の増減で行う。
export const GLASSES_CATALOG = [false, false, false, true] as const;

/**
 * (personaId, attempt) から各軸を決定的に選ぶ。
 *
 * 同一 (personaId, attempt) は常に同一の軸集合。attempt を変えると別の軸を引く（再生成＝探索）。
 * 各軸で異なる salt を使い、軸同士が連動しないようにする。androgynous には seed が無く、この関数は
 * 呼ばれない（呼び出し側が selectSeed の null で先に分岐する）ため、外見表現は SeedPresentation に限る。
 */
export const resolveVariation = (
	personaId: string,
	attempt: number,
	generation: Generation,
	presentation: SeedPresentation
): Variation => ({
	hair: pickDeterministic(HAIR_CATALOG[generation][presentation], personaId, attempt, 'hair'),
	body: pickDeterministic(BODY_CATALOG, personaId, attempt, 'body'),
	pose: pickDeterministic(POSE_CATALOG, personaId, attempt, 'pose'),
	angle: pickDeterministic(ANGLE_CATALOG, personaId, attempt, 'angle'),
	glasses: pickDeterministic(GLASSES_CATALOG, personaId, attempt, 'glasses')
});
