// 編集ベースの生成プロンプト（**唯一のプロンプト定義**。verify も本番もこれを使う・Req 1.4）。
//
// 3.1 の編集で「別人だが seed の頭サイズ・目線・様式は保つ」ことを確かめた結果を反映。学んだ制約:
//   - 「枠」「上半身」という曖昧・誘発語を使わない。保つ対象は「頭の大きさ」「目線の高さ」「様式」を具体語で。
//   - 体型は seed で振れないので必ず指示する。向き・ポーズは指示しない（編集で指示すると
//     スケールが崩れると確認済み。これらは seed 選択に委ねる）。
//   - 性別・年代は seed 画像だけに頼らず本文でも明示して錨にする（「別人にする」で seed の性別が
//     上書きされる事故を防ぐ）。服装は職業から機械的にスーツにせず、ペルソナの生活実態
//     （立場・国籍・関心事・背景の年収/暮らしぶり）に合わせる。

import type { Variation } from './avatar-variation.js';
import type { Presentation } from './avatar-seeds.js';

/** プロンプトの入力。可変軸（Variation）に、persona 由来の年齢・外見表現・具体プロフィールを足したもの。 */
export interface AvatarVariation extends Variation {
	age: number;
	genderPresentation: Presentation;
	occupation: string;
	specificRole: string;
	nationality: string;
	background: string;
	interests: string;
}

const PRESENTATION_LABEL: Record<Presentation, string> = {
	masculine: '男性的な外見',
	feminine: '女性的な外見',
	androgynous: '中性的な外見'
};

export const buildAvatarPrompt = (v: AvatarVariation): string =>
	[
		'これは画像編集の指示。添付した画像を編集して、別人のアバターにする。ただし性別と年代は元画像から変えない。次を必ず守る。',
		'- 出力は正方形（縦と横が同じ長さ）の画像にする。',
		'- 頭の大きさ（画面に占める頭のサイズ）と目線の高さを、元画像と同じにする。',
		`- この人物は${PRESENTATION_LABEL[v.genderPresentation]}。元画像の性別を保ち、変えない。`,
		`- 年代は${v.age}歳相当。年齢は皺や白髪でなく、頭身・生え際・姿勢・髪型のシルエットで表す。`,
		'- 様式は元画像のまま保つ：黒基調のシルエット、顔は描かない（目・鼻・口・眉を描かず白のネガティブスペース）、背景は白一色、影は描かない。',
		'- 髪・衣服・体の輪郭は黒基調でベタ塗りのシルエットにする（グレー・写実的な陰影にしない）。',
		'- 白髪を描く場合は、髪を黒く塗ったうえに白い細い筋（毛流れ）を入れて表す。',
		'- 服装は、この人物の暮らしぶり（年代・立場・経済状況・生活実態・関心事）にふさわしいものにする。職業から機械的にスーツにせず、下記の実態に合わせる。',
		`  立場: ${v.specificRole || v.occupation}（${v.nationality}）。関心事: ${v.interests}。背景: ${v.background}`,
		'  ※立場・関心事・背景は服装・年代・雰囲気の判断にだけ使い、小物・場面・情景は描かない（背景は白一色のまま／顔も描かない）。',
		`- 変えるのは人物を別人にすることと、次だけ：髪型を「${v.hair}」にする / 体型を「${v.body}」にする / メガネ${v.glasses ? `（形状は${v.glassesShape}・${v.glassesRim}）をかける（レンズ内と目は描かない）` : 'はかけない'}`
	].join('\n');
