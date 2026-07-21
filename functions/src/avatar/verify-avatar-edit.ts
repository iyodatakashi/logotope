// 単一画像の編集で「別人だが枠・様式は保つ」を 3.1 で探る実験（**本体は変更しない・別ファイル**）。
//
// 学んだ制約を反映:
//   - モデルは AVATAR_IMAGE_MODEL（現在 gemini-3.1-flash-image。編集が強い）。
//   - **向き（アングル）は seed から引き継がれるので、プロンプトで言葉で指示しない**。向きの変更は
//     局所編集で済まず新規生成に倒れ、スケールが崩れるため、seed の向きのまま（変えない）。同様に
//     シルエットを作り替える指定（大きな体型・ポーズ変更）もしない。
//   - **「枠」「上半身」という曖昧・誘発語を使わない**。保つ対象は「頭の大きさ」「目線の高さ」「様式」
//     を具体語で指示する（向きは seed 準拠で不指示）。
//   - 変えるのは編集で済む範囲（髪型・服装・メガネ）だけ。
//
// 目的: 3.1 の編集で、seed を保ったまま別人にできるか／同一デモグラでスケールが揃うかを、
// 再現可能な形で確かめる。使い捨てにしない。
//
// 実行: cd functions && GEMINI_API_KEY=... npx tsx src/avatar/verify-avatar-edit.ts
// 出力: functions/src/avatar/verify/（out_*.png のみ）.gitignore 済み

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { toGeneration, selectSeed, type SeedPresentation } from './avatar-seeds.js';
import { resolveVariation } from './avatar-variation.js';
import { generateImage } from './avatar-image-client.js';

interface Case {
	id: string;
	personaId: string;
	age: number;
	presentation: SeedPresentation;
	occupation: string;
}

// 同一年齢帯×性別（middle・feminine）。スケールが揃うべき集合。
const CASES: Case[] = [
	{ id: 'mid_f_1', personaId: 'v-mid-f-a', age: 39, presentation: 'feminine', occupation: '看護師' },
	{ id: 'mid_f_2', personaId: 'v-mid-f-b', age: 43, presentation: 'feminine', occupation: '会社員' },
	{ id: 'mid_f_3', personaId: 'v-mid-f-c', age: 36, presentation: 'feminine', occupation: '弁護士' }
];

const SEED_DIR = fileURLToPath(new URL('./seeds', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('./verify', import.meta.url));

// 単一画像の編集プロンプト。保つ対象を具体語で列挙し、向きは変えない。
const buildEditPrompt = (hair: string, occupation: string, glasses: boolean): string =>
	[
		'これは画像編集の指示。添付した画像を編集して、別人のアバターにする。次を必ず守る。',
		'- 頭の大きさ（画面に占める頭のサイズ）と目線の高さを、元画像と同じにする。',
		'- 様式は元画像のまま保つ：黒基調のシルエット、顔は描かない（目・鼻・口・眉を描かず白のネガティブスペース）、背景は白一色、影は描かない。',
		'- 髪・衣服・体の輪郭は黒基調でベタ塗りのシルエットにする（グレー・写実的な陰影にしない）。seed に含まれる襟・ボタン・眼鏡などの細い線描には一致させる。',
		`- 変えるのは人物を別人にすることと、次だけ：髪型を「${hair}」にする / 服装を「${occupation}にふさわしい服」にする / メガネ${glasses ? 'をかける（黒いフレームのみ・レンズ内と目は描かない）' : 'はかけない'}`
	].join('\n');

// seed（アルファ透過）を白背景へ合成した編集元画像。
const buildSeedImage = (seedFile: string): Promise<Buffer> =>
	sharp(join(SEED_DIR, seedFile)).flatten({ background: '#ffffff' }).png().toBuffer();

const main = async () => {
	if (!process.env.GEMINI_API_KEY) {
		console.error('GEMINI_API_KEY が未設定。編集は実 API 生成が要る。');
		process.exit(1);
	}
	await mkdir(OUT_DIR, { recursive: true });

	for (const testCase of CASES) {
		const generation = toGeneration(testCase.age);
		const seed = selectSeed(testCase.personaId, 0, generation, testCase.presentation);
		if (!seed) {
			console.log(`skip ${testCase.id}: seed 無し`);
			continue;
		}
		const seedImage = await buildSeedImage(seed.fileName);
		const variation = resolveVariation(testCase.personaId, 0, generation, testCase.presentation);
		const prompt = buildEditPrompt(variation.hair, testCase.occupation, variation.glasses);
		try {
			const raw = await generateImage(prompt, new Uint8Array(seedImage));
			await writeFile(join(OUT_DIR, `out_${testCase.id}.png`), Buffer.from(raw));
			console.log(`OK   ${testCase.id}  seed=${seed.fileName}`);
		} catch (err) {
			console.log(`FAIL ${testCase.id}  ${(err as Error).message}`);
		}
	}

	console.log(`\n出力: ${OUT_DIR}（out_*.png のみ）`);
};

main().catch((err) => {
	console.error(err.message ?? err);
	process.exit(1);
});
