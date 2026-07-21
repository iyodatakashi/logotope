// フィジビリ検証: 実際にアバターを生成し、機械判定できる基準を測る。
//
// 出力は functions/src/avatar/verify/ に保存する（コミット対象外の検証成果物）。
// **機械判定できない項目（様式・顔の非描写・軸の適合）は人が見る。** ここでは判定しない。
//
// 実行: cd functions && GEMINI_API_KEY=... npx tsx src/scripts/verify-avatar-generation.ts

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { buildAvatarPrompt, type AvatarVariation } from '../avatar/avatar-prompt.js';
import {
	seedFileName,
	SEED_SUBJECT_HEIGHT_RATIO,
	type Generation,
	type Presentation
} from '../avatar/avatar-seeds.js';

const MODEL = 'gemini-3.1-flash-image';
const SEED_DIR = fileURLToPath(new URL('../avatar/seeds', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../avatar/verify', import.meta.url));

const SUBJECT_WHITE = 245;
/** 枠の転写の許容誤差。 */
const HEIGHT_TOLERANCE = 0.06;
const BOTTOM_TOLERANCE = 0.01;

interface Case extends AvatarVariation {
	id: string;
	generation: Generation;
	presentation: Presentation;
	seedIndex: number;
}

/** 全10バケットを網羅し、中年層は同一バケット内での散り方も見る。 */
const CASES: Case[] = [
	{ id: '01_child_m', generation: 'child', presentation: 'male', seedIndex: 1, age: 10, occupation: '小学生', hair: 'ベリーショート', body: '細身', pose: '腕組み', angle: '正面', glasses: 'なし' },
	{ id: '02_child_f', generation: 'child', presentation: 'female', seedIndex: 2, age: 11, occupation: '小学生', hair: 'ツインテール', body: '標準', pose: '手を下ろす', angle: '斜め約30度', glasses: 'なし' },
	{ id: '03_young_m', generation: 'young', presentation: 'male', seedIndex: 3, age: 24, occupation: 'エンジニア', hair: 'ツーブロック', body: '細身', pose: '顎に手', angle: '斜め約30度', glasses: 'あり' },
	{ id: '04_young_f', generation: 'young', presentation: 'female', seedIndex: 4, age: 21, occupation: '大学生', hair: 'お団子アップ', body: '標準', pose: '腕組み', angle: '正面', glasses: 'なし' },
	{ id: '05_middle_m_a', generation: 'middle', presentation: 'male', seedIndex: 1, age: 38, occupation: '営業職', hair: 'ツーブロック', body: '筋肉質（肩幅が広い）', pose: '腕組み', angle: '正面', glasses: 'なし' },
	{ id: '06_middle_m_b', generation: 'middle', presentation: 'male', seedIndex: 2, age: 45, occupation: '工場勤務', hair: '坊主', body: '肥満（二重顎・太い首・恰幅がある）', pose: '手を下ろす', angle: '正面', glasses: 'なし' },
	{ id: '07_middle_m_c', generation: 'middle', presentation: 'male', seedIndex: 3, age: 34, occupation: 'デザイナー', hair: 'ウルフカット', body: '細身', pose: '顎に手', angle: '斜め約30度', glasses: 'あり' },
	{ id: '08_middle_f_a', generation: 'middle', presentation: 'female', seedIndex: 1, age: 39, occupation: '看護師', hair: 'ミディアムボブ', body: '細身', pose: '腕組み', angle: '正面', glasses: 'なし' },
	{ id: '09_middle_f_b', generation: 'middle', presentation: 'female', seedIndex: 2, age: 43, occupation: '会社員', hair: 'ストレートロング', body: '肥満（二重顎・太い首・恰幅がある）', pose: '手を下ろす', angle: '正面', glasses: 'なし' },
	{ id: '10_middle_f_c', generation: 'middle', presentation: 'female', seedIndex: 3, age: 36, occupation: '弁護士', hair: 'ショートボブ', body: '標準', pose: '横向き', angle: '斜め約30度', glasses: 'あり' },
	{ id: '11_senior_m', generation: 'senior', presentation: 'male', seedIndex: 1, age: 58, occupation: '経営者', hair: 'オールバック', body: '筋肉質（肩幅が広い）', pose: '腕組み', angle: '正面', glasses: 'なし' },
	{ id: '12_senior_f', generation: 'senior', presentation: 'female', seedIndex: 2, age: 62, occupation: '教員', hair: 'ゆるパーマショート', body: '標準', pose: '顎に手', angle: '斜め約30度', glasses: 'あり' },
	{ id: '13_elder_m', generation: 'elder', presentation: 'male', seedIndex: 1, age: 76, occupation: '元教師', hair: '頭頂部薄毛', body: '細身', pose: '手を下ろす', angle: '正面', glasses: 'あり' },
	{ id: '14_elder_f', generation: 'elder', presentation: 'female', seedIndex: 2, age: 72, occupation: '元看護師', hair: 'グレイヘアショート', body: '標準', pose: '腕組み', angle: '正面', glasses: 'なし' }
];

interface Frame {
	width: number;
	height: number;
	heightRatio: number;
	bottomMargin: number;
}

const measureFrame = async (png: Buffer): Promise<Frame | null> => {
	const { data, info } = await sharp(png)
		.greyscale()
		.raw()
		.toBuffer({ resolveWithObject: true });

	let top = info.height;
	let bottom = -1;
	for (let y = 0; y < info.height; y++) {
		for (let x = 0; x < info.width; x++) {
			if (data[y * info.width + x] < SUBJECT_WHITE) {
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

const generate = async (testCase: Case): Promise<Buffer> => {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) throw new Error('GEMINI_API_KEY が未設定');

	const seed = await readFile(
		join(
			SEED_DIR,
			seedFileName(
				{ generation: testCase.generation, presentation: testCase.presentation },
				testCase.seedIndex
			)
		)
	);

	const google = createGoogleGenerativeAI({ apiKey });
	const result = await generateText({
		model: google(MODEL),
		// 画像モーダリティを明示する（未指定だとテキストのみ返る）
		providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } },
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: buildAvatarPrompt(testCase) },
					{ type: 'file', data: seed, mediaType: 'image/png' }
				]
			}
		]
	});

	const image = result.files.find((file) => file.mediaType?.startsWith('image/'));
	if (!image) throw new Error('画像が返らなかった');
	return Buffer.from(image.uint8Array);
};

const main = async () => {
	await mkdir(OUT_DIR, { recursive: true });

	const results = await Promise.all(
		CASES.map(async (testCase) => {
			try {
				const png = await generate(testCase);
				await writeFile(join(OUT_DIR, `${testCase.id}.png`), png);
				return { testCase, frame: await measureFrame(png), error: null as string | null };
			} catch (err) {
				return { testCase, frame: null, error: (err as Error).message };
			}
		})
	);

	console.log('\n枠の転写（機械判定できる項目のみ）');
	console.log('  規定: 縦占有 0.92 / 下端接地');
	console.log('  ※ 様式・顔の非描写・軸の適合は判定していない。人が見ること。\n');

	let conforming = 0;
	for (const { testCase, frame, error } of results) {
		if (error) {
			console.log(`  FAIL ${testCase.id}  ${error}`);
			continue;
		}
		if (!frame) {
			console.log(`  FAIL ${testCase.id}  被写体を検出できない`);
			continue;
		}
		const squareOk = frame.width === frame.height;
		const heightOk = Math.abs(frame.heightRatio - SEED_SUBJECT_HEIGHT_RATIO) <= HEIGHT_TOLERANCE;
		const bottomOk = frame.bottomMargin <= BOTTOM_TOLERANCE;
		const ok = squareOk && heightOk && bottomOk;
		if (ok) conforming++;
		console.log(
			`  ${ok ? 'OK  ' : 'NG  '} ${testCase.id}  ` +
				`${frame.width}x${frame.height}${squareOk ? '' : ' ← 非正方'}  ` +
				`縦占有 ${frame.heightRatio.toFixed(3)}  下余白 ${frame.bottomMargin.toFixed(3)}`
		);
	}
	console.log(`\n  枠が転写された: ${conforming}/${results.length}`);
};

main().catch((err) => {
	console.error(err.message ?? err);
	process.exit(1);
});
