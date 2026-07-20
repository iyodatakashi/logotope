// 規範プロンプトの組み立て: スタイル固定文＋各軸の値を明示的に埋め込み、
// 既存サンプルを参照画像（最大3枚）としてスタイルアンカーにする。
// 同一 spec から同一プロンプトが再現的に得られる（決定的）。
// スタイル固定文は prompt.md と同一の趣旨を保つ（人間可読版は prompt.md）。

import type { AgeBand, Angle, Gender, VariationSpec } from './variation-spec';

// スタイル固定文。常に含める。狙い＝「シルエット（髪・衣服・輪郭は黒でベタ塗り）だが、
// 正面から分かるよう顔・肌は白抜き featureless」。原サンプルの作られ方（text-only）に合わせる。
export const STYLE_FIXED_CLAUSES: string[] = [
	'髪・衣服・体の輪郭は黒一色でベタ塗りのシルエットにする（線画・グレー・陰影にしない。白髪や明るい色の髪も黒で塗る）',
	'顔・首・肌は塗らず白（背景と同じ）のまま残し、featureless にする',
	'目・鼻・口・眉・まつげ・顔の輪郭線を一切描かない',
	'背景は無地の白一色にする（グラデーション・小物・影・枠を置かない）',
	'構図はバストアップにする（胸から上、正方1:1の枠に収める）',
	'全体をアイコン的に単純化する（写実的な描き込み・テクスチャ・柄を避ける）'
];

// 原サンプルは参照画像なし（text-only）で作られたため、参照画像は添付しない。
// 参照を足すと非対象デモグラでスタイルが崩れるため、スタイルは言葉のみで固定する。
export const REFERENCE_IMAGES: string[] = [];

const AGE_BAND_LABEL: Record<AgeBand, string> = {
	child: '10歳（子供）',
	teens_twenties: '10〜20代',
	thirties_forties: '30〜40代',
	fifties_sixties: '50〜60代',
	seventies_plus: '70代以上'
};

const GENDER_LABEL: Record<Gender, string> = {
	female: '女性',
	male: '男性'
};

const ANGLE_LABEL: Record<Angle, string> = {
	front: '正面',
	oblique30: '斜め約30度'
};

export const buildPrompt = (spec: VariationSpec): { prompt: string; referenceImages: string[] } => {
	const styleSection = ['# スタイル（固定）', ...STYLE_FIXED_CLAUSES.map((clause) => `- ${clause}`)];
	const variationSection = [
		'# バリエーション（指定値で出し分ける）',
		`- 年齢帯: ${AGE_BAND_LABEL[spec.ageBand]}`,
		`- 性別: ${GENDER_LABEL[spec.gender]}`,
		`- 髪型: ${spec.hairStyle}`,
		`- アングル: ${ANGLE_LABEL[spec.angle]}`,
		`- 服装: ${spec.outfit}`,
		`- メガネ: ${spec.glasses ? 'あり（黒いフレームのみをシルエットで描き、レンズ内・目は描かない）' : 'なし'}`
	];
	const referenceSection = [
		'# 参照画像',
		'- 添付した既存サンプルの様式（構図・黒基調・単純化）に寄せる。人物の同一性は模倣しない。'
	];
	const prompt = [...styleSection, '', ...variationSection, '', ...referenceSection].join('\n');
	return { prompt, referenceImages: REFERENCE_IMAGES };
};
