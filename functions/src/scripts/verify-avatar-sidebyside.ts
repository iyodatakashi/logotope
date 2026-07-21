// side-by-side スケール実験（**本体＝本番エンジンは変更しない・別ファイル**）。
//
// 目的: 「左に seed、右を空白にした1枚」を作り、「右に同一デモグラの別人を、左と顔サイズ・目線を
// 合わせて描け」と指示して生成する。同一年齢帯×性別の複数ペルソナで、生成物のスケールが揃うかを
// **再現可能な形で**確かめる。使い捨てにしない：このファイルに残し、鍵があればいつでも再実行できる。
//
// 本番の seed 選択・可変軸・画像クライアントは再利用する（avatar-seeds / avatar-variation /
// avatar-image-client）。side-by-side 専用のプロンプトと合成・切り出し・montage だけをここに持つ。
// 本番 buildAvatarPrompt（単一画像の編集プロンプト）には手を加えない。
//
// seed と出力の年齢性別は必ず一致する（selectSeed がペルソナのデモグラで選ぶ）。スケールの揃いを
// 見るため、CASES は同一年齢帯×性別で組む。
//
// 実行: cd functions && GEMINI_API_KEY=... npx tsx src/scripts/verify-avatar-sidebyside.ts
// 出力: functions/src/avatar/verify/（input_*.png / full_*.png）.gitignore 済み

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { toGeneration, selectSeed, type SeedPresentation } from '../avatar/avatar-seeds.js';
import { resolveVariation, type Variation } from '../avatar/avatar-variation.js';
import { generateImage } from '../avatar/avatar-image-client.js';

interface Case {
	id: string;
	personaId: string;
	age: number;
	presentation: SeedPresentation;
	occupation: string;
}

// 同一年齢帯×性別（middle・masculine）。seed も出力も middle 男性で揃うべき集合。
const CASES: Case[] = [
	{ id: 'mid_m_1', personaId: 'v-mid-m-a', age: 38, presentation: 'masculine', occupation: '営業職' },
	{ id: 'mid_m_2', personaId: 'v-mid-m-b', age: 45, presentation: 'masculine', occupation: '工場勤務' },
	{ id: 'mid_m_3', personaId: 'v-mid-m-c', age: 34, presentation: 'masculine', occupation: 'デザイナー' }
];

const SEED_DIR = fileURLToPath(new URL('../avatar/seeds', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../avatar/verify', import.meta.url));

const CELL = 256;

// side-by-side 専用プロンプト（本体 buildAvatarPrompt とは別）。
const buildSideBySidePrompt = (v: Variation & { age: number; occupation: string }): string =>
	[
		'これは画像編集の指示。添付画像は、左半分に基準の人物、右半分は空白（白）です。',
		'右半分に、左とは別人のアバターを1体描く。左半分はそのまま一切変えない。',
		'- 左の人物の「顔の大きさ」と「目線の高さ」に、右の人物を完全に一致させる（最重要）。',
		'- 右の様式は左に合わせる：黒基調のシルエット、顔は描かない（目・鼻・口・眉を描かず白のネガティブスペース）、背景は白、影を描かない。',
		`- 右の人物: 年齢${v.age}歳（皺や灰色でなくシルエットで表す） / 髪型${v.hair} / 体型${v.body} / ポーズ${v.pose} / アングル${v.angle} / 服装${v.occupation}にふさわしい服装 / メガネ${v.glasses ? 'あり' : 'なし'}`
	].join('\n');

// 左に seed、右を空白（白）にした CELL×2 の入力を作る。
const buildInput = async (seedFile: string): Promise<Buffer> => {
	const seed = await sharp(join(SEED_DIR, seedFile))
		.resize(CELL, CELL)
		.flatten({ background: '#ffffff' })
		.png()
		.toBuffer();
	return sharp({ create: { width: CELL * 2, height: CELL, channels: 3, background: '#ffffff' } })
		.composite([{ input: seed, left: 0, top: 0 }])
		.png()
		.toBuffer();
};

// input（送った画像）と full（出力）を左右に並べ、横ガイド線を引く。スケールの揃いを目視する用。
const buildMontage = async (ids: string[]): Promise<void> => {
	if (ids.length === 0) return;
	const rowHeight = 320;
	const pad = 10;
	const gap = 14;
	const scaled = async (file: string): Promise<{ data: Buffer; width: number }> => {
		const data = await sharp(join(OUT_DIR, file))
			.resize({ height: rowHeight })
			.flatten({ background: '#ffffff' })
			.png()
			.toBuffer();
		return { data, width: (await sharp(data).metadata()).width ?? rowHeight };
	};
	const rows = await Promise.all(
		ids.map(async (id) => ({
			input: await scaled(`input_${id}.png`),
			full: await scaled(`full_${id}.png`)
		}))
	);
	const rowWidth = Math.max(...rows.map((r) => r.input.width + gap + r.full.width));
	const width = rowWidth + pad * 2;
	const height = ids.length * rowHeight + (ids.length + 1) * pad;
	const tiles = rows.flatMap((r, i) => {
		const top = pad + i * (rowHeight + pad);
		return [
			{ input: r.input.data, top, left: pad },
			{ input: r.full.data, top, left: pad + r.input.width + gap }
		];
	});
	const guides = [0.1, 0.22, 0.34, 0.46, 0.58, 0.7];
	let lines = '';
	for (let i = 0; i < ids.length; i++) {
		for (const g of guides) {
			const y = pad + i * (rowHeight + pad) + Math.round(rowHeight * g);
			lines += `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#e8556b" stroke-width="1" stroke-dasharray="6 6"/>`;
		}
	}
	await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
		.composite([
			...tiles,
			{ input: Buffer.from(`<svg width="${width}" height="${height}">${lines}</svg>`), top: 0, left: 0 }
		])
		.png()
		.toFile(join(OUT_DIR, 'input-vs-full.png'));
};

const main = async () => {
	if (!process.env.GEMINI_API_KEY) {
		console.error('GEMINI_API_KEY が未設定。side-by-side は実 API 生成が要る。');
		process.exit(1);
	}
	await mkdir(OUT_DIR, { recursive: true });

	const done: string[] = [];
	for (const testCase of CASES) {
		const generation = toGeneration(testCase.age);
		const seed = selectSeed(testCase.personaId, 0, generation, testCase.presentation);
		if (!seed) {
			console.log(`skip ${testCase.id}: seed 無し`);
			continue;
		}
		const input = await buildInput(seed.fileName);
		await writeFile(join(OUT_DIR, `input_${testCase.id}.png`), input);

		const prompt = buildSideBySidePrompt({
			...resolveVariation(testCase.personaId, 0, generation, testCase.presentation),
			age: testCase.age,
			occupation: testCase.occupation
		});
		try {
			const raw = await generateImage(prompt, new Uint8Array(input));
			await writeFile(join(OUT_DIR, `full_${testCase.id}.png`), Buffer.from(raw));
			console.log(`OK   ${testCase.id}  seed=${seed.fileName}`);
			done.push(testCase.id);
		} catch (err) {
			console.log(`FAIL ${testCase.id}  ${(err as Error).message}`);
		}
	}

	await buildMontage(done);
	console.log(`\n出力: ${OUT_DIR}`);
	console.log('  input_*.png（送った画像・左=seed/右=空白） / full_*.png（出力） / input-vs-full.png（比較）');
};

main().catch((err) => {
	console.error(err.message ?? err);
	process.exit(1);
});
