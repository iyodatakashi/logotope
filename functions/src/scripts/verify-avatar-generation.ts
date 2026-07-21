// 2.5 検証（成立ゲート・tasks 4.2）: 共有エンジンで実生成し、機械判定できる枠を実測する。
//
// ここを通るまで本番配線（tasks 5）へ進まない。**本番と同じ共有エンジン generateAvatarAsset を
// 呼ぶ**（検証と本番で経路を分けない・Req 1.4）。モデルは AVATAR_IMAGE_MODEL
// （gemini-2.5-flash-image・先行フィジビリで実績が確定しているモデル）。
//
//   機械判定（ここで自動）: 枠＝正方・縦占有 0.92・下端接地。
//   人が判定（Req 7.3・ここでは判定しない）: 様式・顔の非描写・指定軸への適合・頭サイズの一貫。
//
// 出力は入力 seed とは別ディレクトリ（Req 1.3）: src/avatar/verify/（.gitignore 済み・コミット対象外）。
// 全10バケット（世代5×外見表現2）を網羅し、middle は同一バケット内の散りも見る。personaId を
// 変えるだけで seed／可変軸が決定的に散る。
//
// 実行: cd functions && GEMINI_API_KEY=... npx tsx src/scripts/verify-avatar-generation.ts

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { generateAvatarAsset, type AvatarSpec } from '../avatar/avatar-engine.js';
import { SUBJECT_HEIGHT_RATIO } from '../avatar/avatar-constants.js';

const OUT_DIR = fileURLToPath(new URL('../avatar/verify', import.meta.url));

/** 枠の転写の許容誤差。 */
const HEIGHT_TOLERANCE = 0.06;
const BOTTOM_TOLERANCE = 0.01;

interface Case {
	id: string;
	spec: AvatarSpec;
}

const spec = (
	personaId: string,
	age: number,
	genderPresentation: AvatarSpec['genderPresentation'],
	occupation: string
): AvatarSpec => ({ personaId, attempt: 0, age, genderPresentation, occupation });

const CASES: Case[] = [
	{ id: '01_child_m', spec: spec('v-child-m', 10, 'masculine', '小学生') },
	{ id: '02_child_f', spec: spec('v-child-f', 11, 'feminine', '小学生') },
	{ id: '03_young_m', spec: spec('v-young-m', 24, 'masculine', 'エンジニア') },
	{ id: '04_young_f', spec: spec('v-young-f', 21, 'feminine', '大学生') },
	{ id: '05_middle_m_a', spec: spec('v-mid-m-a', 38, 'masculine', '営業職') },
	{ id: '06_middle_m_b', spec: spec('v-mid-m-b', 45, 'masculine', '工場勤務') },
	{ id: '07_middle_m_c', spec: spec('v-mid-m-c', 34, 'masculine', 'デザイナー') },
	{ id: '08_middle_f_a', spec: spec('v-mid-f-a', 39, 'feminine', '看護師') },
	{ id: '09_middle_f_b', spec: spec('v-mid-f-b', 43, 'feminine', '会社員') },
	{ id: '10_middle_f_c', spec: spec('v-mid-f-c', 36, 'feminine', '弁護士') },
	{ id: '11_senior_m', spec: spec('v-senior-m', 58, 'masculine', '経営者') },
	{ id: '12_senior_f', spec: spec('v-senior-f', 62, 'feminine', '教員') },
	{ id: '13_elder_m', spec: spec('v-elder-m', 76, 'masculine', '元教師') },
	{ id: '14_elder_f', spec: spec('v-elder-f', 72, 'feminine', '元看護師') }
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
	if (!process.env.GEMINI_API_KEY) {
		console.error('GEMINI_API_KEY が未設定。2.5 検証は実 API 生成が要る。');
		process.exit(1);
	}
	await mkdir(OUT_DIR, { recursive: true });

	const results = await Promise.all(
		CASES.map(async ({ id, spec }) => {
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
