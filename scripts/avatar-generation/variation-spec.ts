// バリエーション仕様（機械可読）: 軸・区分値・(年齢帯 × 性別) 別の髪型カタログ・
// serial ↔ 髪型 の安定対応。オフライン生成の出し分けと命名の単一情報源。

export type AgeBand =
	| 'child'
	| 'teens_twenties'
	| 'thirties_forties'
	| 'fifties_sixties'
	| 'seventies_plus';
export type Gender = 'female' | 'male';
export type Angle = 'front' | 'oblique30';

// 出し分ける軸（pose/表情は「話している最中の真剣な様子」で固定するため軸に持たない）
export interface VariationSpec {
	ageBand: AgeBand;
	gender: Gender;
	hairStyle: string;
	angle: Angle;
	outfit: string;
	glasses: boolean;
}

// serial は発番後不変の通し番号。個体＝仕様に安定同一性キーを与える。
export interface AvatarIndividual extends VariationSpec {
	serial: string;
}

// 命名規則の年齢帯コード（範囲が自明な形で一意識別）
export const AGE_BAND_CODE: Record<AgeBand, string> = {
	child: 'child',
	teens_twenties: '10s20s',
	thirties_forties: '30s40s',
	fifties_sixties: '50s60s',
	seventies_plus: '70plus'
};

// (年齢帯 × 性別) 別の髪型カタログ。原則1個体=1髪型。若年ほど多く、70代以上は薄毛・禿頭を含め絞る。
export const HAIR_CATALOG: Record<AgeBand, Record<Gender, string[]>> = {
	child: {
		female: [
			'ショートボブ',
			'おかっぱ',
			'ツインテール',
			'ポニーテール',
			'三つ編み',
			'お団子',
			'前髪ぱっつんロング',
			'サイドテール'
		],
		male: [
			'ベリーショート',
			'刈り上げショート',
			'マッシュ',
			'ソフトモヒカン',
			'くせ毛マッシュ',
			'スポーツ刈り',
			'坊主',
			'前髪長めマッシュ'
		]
	},
	teens_twenties: {
		female: [
			'ロングストレート',
			'セミロング',
			'ミディアムレイヤー',
			'ボブ',
			'ショートボブ',
			'ポニーテール',
			'お団子アップ',
			'ゆる巻きミディアム',
			'ショートカット',
			'前髪ありロング'
		],
		male: [
			'マッシュ',
			'ツーブロック',
			'センターパート',
			'ショートレイヤー',
			'刈り上げショート',
			'パーマショート',
			'ベリーショート',
			'ウルフカット',
			'七三',
			'前下がりマッシュ'
		]
	},
	thirties_forties: {
		female: [
			'セミロング',
			'ミディアムボブ',
			'レイヤーロング',
			'ワンレングスボブ',
			'ゆる巻きミディアム',
			'ハーフアップ',
			'ショートボブ',
			'ストレートロング',
			'アップスタイル',
			'前髪ありロング'
		],
		male: [
			'ビジネスショート',
			'ツーブロックショート',
			'七三',
			'オールバック',
			'マッシュショート',
			'刈り上げ',
			'パーマショート',
			'ソフトモヒカン',
			'ナチュラルショート',
			'スキンフェード'
		]
	},
	fifties_sixties: {
		female: [
			'ショートレイヤー',
			'ミディアムボブ',
			'ゆるパーマショート',
			'ワンレンボブ',
			'まとめ髪',
			'グレイヘアショート',
			'ふんわりショート',
			'セミロング'
		],
		male: [
			'白髪交じりショート',
			'七三',
			'刈り上げ',
			'額の後退気味ショート',
			'オールバック',
			'ソフトパーマ',
			'ナチュラルショート'
		]
	},
	seventies_plus: {
		female: [
			'ふんわりショートパーマ',
			'グレイヘアショート',
			'ショートボブ',
			'薄毛気味ショート',
			'まとめ髪'
		],
		male: ['白髪短髪', '頭頂部薄毛', 'ほぼ禿頭（サイドのみ）', '白髪オールバック', '坊主']
	}
};

// serial ↔ 髪型 の対応表。カタログの並び順に依存させず、発番済みの個体を明示登録する。
// 本スペックはフィジビリのため代表バケットの少数個体のみ登録する（量産は別フェーズ）。
export const SERIAL_REGISTRY: AvatarIndividual[] = [
	{
		serial: '01',
		ageBand: 'thirties_forties',
		gender: 'female',
		hairStyle: 'ストレートロング',
		angle: 'front',
		outfit: 'シンプルなニット',
		glasses: false
	},
	{
		serial: '02',
		ageBand: 'thirties_forties',
		gender: 'female',
		hairStyle: 'ショートボブ',
		angle: 'oblique30',
		outfit: 'ジャケット',
		glasses: true
	},
	{
		serial: '01',
		ageBand: 'thirties_forties',
		gender: 'male',
		hairStyle: 'ビジネスショート',
		angle: 'front',
		outfit: 'ワイシャツ',
		glasses: false
	},
	{
		serial: '01',
		ageBand: 'teens_twenties',
		gender: 'female',
		hairStyle: 'ロングストレート',
		angle: 'front',
		outfit: 'カジュアルシャツ',
		glasses: false
	},
	{
		serial: '01',
		ageBand: 'seventies_plus',
		gender: 'male',
		hairStyle: '白髪短髪',
		angle: 'oblique30',
		outfit: 'カーディガン',
		glasses: true
	}
];

export const hairCatalogFor = (ageBand: AgeBand, gender: Gender): string[] =>
	HAIR_CATALOG[ageBand][gender];

// (年齢帯 × 性別 × serial) から生成対象を一意に解決する。カタログ整合も検証する。
export const resolveVariation = (
	ageBand: AgeBand,
	gender: Gender,
	serial: string
): AvatarIndividual => {
	const individual = SERIAL_REGISTRY.find(
		(entry) => entry.ageBand === ageBand && entry.gender === gender && entry.serial === serial
	);
	if (!individual) {
		throw new Error(`未登録の個体: ${AGE_BAND_CODE[ageBand]}_${gender}_${serial}`);
	}
	if (!hairCatalogFor(ageBand, gender).includes(individual.hairStyle)) {
		throw new Error(
			`髪型「${individual.hairStyle}」は ${AGE_BAND_CODE[ageBand]}/${gender} のカタログに無い`
		);
	}
	return individual;
};

export const assetFileName = (individual: AvatarIndividual): string =>
	`${AGE_BAND_CODE[individual.ageBand]}_${individual.gender}_${individual.serial}.png`;
