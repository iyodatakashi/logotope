// 実生成検証（成立ゲート・tasks 4.2）: 共有エンジンで実生成し、機械判定できる枠を実測する。
//
// ここを通るまで本番配線（tasks 5）へ進まない。**本番と同じ共有エンジン generateAvatarAsset を
// 呼ぶ**（検証と本番で経路を分けない・Req 1.4）。モデルは AVATAR_IMAGE_MODEL
// （gemini-3.1-flash-image）。
//
//   機械判定（ここで自動）: 枠＝正方・縦占有 0.92・下端接地。
//   人が判定（Req 7.3・ここでは判定しない）: 様式・顔の非描写・指定軸への適合・頭サイズの一貫。
//
// 出力は入力 seed とは別ディレクトリ（Req 1.3）: src/avatar/verify/（.gitignore 済み・コミット対象外）。
// seed は child/middle/elder × 3外見表現の9バケット（young/senior は骨格の近い middle を流用）。
// 髪型など可変軸は世代5区分で引く。seed・可変軸は生成のたびランダムに引かれる。
//
// 実行: cd functions && GEMINI_API_KEY=... npx tsx src/avatar/verify-avatar-generation.ts

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { generateAvatarAsset, type AvatarSpec } from './avatar-engine.js';
import { toGeneration, toSeedGeneration } from './avatar-seeds.js';
import { SUBJECT_HEIGHT_RATIO } from './avatar-constants.js';

// そのケースの世代（髪型用）と seed プール（seed の世代×外見表現）。seed・可変軸は生成のたびランダムなので、
// DRY では年齢→世代・seed の世代への写像だけを確認する。
const bucketOf = (s: AvatarSpec): string => {
	const generation = toGeneration(s.age);
	const seedGeneration = toSeedGeneration(generation);
	return `${generation}/${s.genderPresentation}  seed=${seedGeneration}/${s.genderPresentation}  (生成ごとランダム)`;
};

const OUT_DIR = fileURLToPath(new URL('./verify', import.meta.url));

/** 枠の転写の許容誤差。 */
const HEIGHT_TOLERANCE = 0.06;
const BOTTOM_TOLERANCE = 0.01;

interface Case {
	id: string;
	spec: AvatarSpec;
}

const spec = (
	age: number,
	genderPresentation: AvatarSpec['genderPresentation'],
	occupation: string,
	extra: Partial<AvatarSpec> = {}
): AvatarSpec => ({
	age,
	genderPresentation,
	occupation,
	specificRole: occupation,
	nationality: '日本',
	background: '',
	interests: '',
	...extra
});

const CASES: Case[] = [
	{ id: '1_child_m', spec: spec(10, 'masculine', '小学生') },
	{ id: '2_young_m', spec: spec(24, 'masculine', 'エンジニア') },
	{ id: '3_middle_m', spec: spec(38, 'masculine', '営業職') },
	{ id: '4_middle_f', spec: spec(39, 'feminine', '看護師') },
	{ id: '5_senior_m', spec: spec(58, 'masculine', '経営者') },
	{ id: '6_senior_f', spec: spec(62, 'feminine', '教員') },
	{ id: '7_elder_f', spec: spec(72, 'feminine', '元看護師') },
	// androgynous（中性的な外見）も seed があり生成できる（middle 41歳 → middle の androgynous プール）。
	{ id: '7b_middle_a', spec: spec(41, 'androgynous', 'フリーランス') },
	// 服装が背景ドリブンで変わるか（職業=無し／年金・支援で生活が苦しい高齢者）を目視確認するケース。
	{
		id: '8_elder_m_hardship',
		spec: spec(72, 'masculine', '', {
			specificRole: '再審無罪となった元受刑者',
			background:
				'獄中生活30年超を経て70代で再審無罪。現在は姉と二人暮らしで体調は良くなく、年金と支援団体の援助で暮らし、生活は苦しい。',
			interests: '将棋と散歩'
		})
	}
];

interface Frame {
	width: number;
	height: number;
	heightRatio: number;
	bottomMargin: number;
}

// 最終アセットはアルファ透過（RGB=黒）なので、被写体＝アルファ>0 で枠を測る。
const measureFrame = async (png: Uint8Array): Promise<Frame | null> => {
	const { data, info } = await sharp(Buffer.from(png))
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	let top = info.height;
	let bottom = -1;
	for (let y = 0; y < info.height; y++) {
		for (let x = 0; x < info.width; x++) {
			if (data[(y * info.width + x) * 4 + 3] > 0) {
				if (y < top) top = y;
				if (y > bottom) bottom = y;
				break;
			}
		}
	}
	if (bottom < 0) return null;

	return {
		width: info.width,
		height: info.height,
		heightRatio: (bottom - top + 1) / info.height,
		bottomMargin: (info.height - 1 - bottom) / info.height
	};
};

const main = async () => {
	// ONLY=部分文字列: 一致する id のケースだけ回す（例: ONLY=child_m）。未指定なら全件。
	const active = process.env.ONLY
		? CASES.filter((c) => c.id.includes(process.env.ONLY as string))
		: CASES;

	// DRY=1: 生成せず、各ケースの seed プール（年齢→世代のマッピングと seed 有無）だけを出す。
	if (process.env.DRY) {
		for (const { id, spec } of active) console.log(`${id}  ${bucketOf(spec)}`);
		return;
	}
	if (!process.env.GEMINI_API_KEY) {
		console.error('GEMINI_API_KEY が未設定。2.5 検証は実 API 生成が要る。');
		process.exit(1);
	}
	await mkdir(OUT_DIR, { recursive: true });

	const results = await Promise.all(
		active.map(async ({ id, spec }) => {
			const result = await generateAvatarAsset(spec);
			if (!result.ok) return { id, frame: null, note: result.reason };
			await writeFile(join(OUT_DIR, `${id}.png`), result.asset);
			return { id, frame: await measureFrame(result.asset), note: null as string | null };
		})
	);

	console.log('\n枠の転写（機械判定できる項目のみ）');
	console.log(`  規定: 縦占有 ${SUBJECT_HEIGHT_RATIO} / 下端接地`);
	console.log('  ※ 様式・顔の非描写・軸の適合・頭サイズの一貫は判定していない。人が見ること（Req 7.3）。\n');

	let conforming = 0;
	for (const { id, frame, note } of results) {
		if (note) {
			console.log(`  FAIL ${id}  ${note}`);
			continue;
		}
		if (!frame) {
			console.log(`  FAIL ${id}  被写体を検出できない`);
			continue;
		}
		const squareOk = frame.width === frame.height;
		const heightOk = Math.abs(frame.heightRatio - SUBJECT_HEIGHT_RATIO) <= HEIGHT_TOLERANCE;
		const bottomOk = frame.bottomMargin <= BOTTOM_TOLERANCE;
		const ok = squareOk && heightOk && bottomOk;
		if (ok) conforming++;
		console.log(
			`  ${ok ? 'OK  ' : 'NG  '} ${id}  ` +
				`${frame.width}x${frame.height}${squareOk ? '' : ' ← 非正方'}  ` +
				`縦占有 ${frame.heightRatio.toFixed(3)}  下余白 ${frame.bottomMargin.toFixed(3)}`
		);
	}
	console.log(`\n  枠が転写された: ${conforming}/${results.length}`);
	console.log('  生成物は src/avatar/verify/ に保存。様式・顔・軸の合否は目視で判定すること。');
};

main().catch((err) => {
	console.error(err.message ?? err);
	process.exit(1);
});
