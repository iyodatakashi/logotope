// 提供された素材から、アバターのシードを生成する。
//
// ## 位置づけ
//
// 成果物は functions/src/avatar/seeds/ の PNG 群であり、**それがコミット対象**である。
// ランタイムは seeds/ だけに依存する。本スクリプトと素材ディレクトリはシードを作り直すときにのみ
// 必要で、無くてもランタイムは動く。
//
// 区分（世代・外見表現）とアセット仕様は avatar-seeds.ts が持つ。ここでは持たない。
// 本スクリプトの責務は「宣言された素材を、宣言された仕様のシードに変換し、検査する」ことだけ。
//
// ## 実行
//   cd functions && npx tsx src/scripts/build-avatar-seeds.ts
// 仕様を満たさないシードが1枚でもあれば、内容を報告して異常終了する。

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
	SEED_BUCKETS,
	SEED_INDICES,
	SEEDS_PER_BUCKET,
	SEED_CANVAS,
	SEED_SUBJECT_HEIGHT_RATIO,
	seedFileName,
	type Generation,
	type Presentation,
	type SeedBucket
} from '../avatar/avatar-seeds.js';

// ==========================================================================================
// 素材の宣言
// ==========================================================================================

/**
 * バケットと素材ファイルの対応。
 *
 * **ファイル名から属性を導出しない。** 素材のリネームでシードのラベルが黙って変わるため。
 * 全バケット分が揃っているかは実行時に検査する（下記 resolveSource）。
 */
const SOURCE_FILES: Record<Generation, Record<Presentation, string>> = {
	child: { male: 'male_child.png', female: 'female_child.png' },
	young: { male: 'male_young.png', female: 'female_young.png' },
	middle: { male: 'male_middle.png', female: 'female_middle.png' },
	senior: { male: 'male_senior.png', female: 'female_senior.png' },
	elder: { male: 'male_elder.png', female: 'female_elder.png' }
};

const SOURCE_DIR = fileURLToPath(new URL('../avatar/sheets', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../avatar/seeds', import.meta.url));

const resolveSource = (bucket: SeedBucket): string => {
	const file = SOURCE_FILES[bucket.generation]?.[bucket.presentation];
	if (!file) {
		throw new Error(`素材が宣言されていない: ${bucket.generation}_${bucket.presentation}`);
	}
	return join(SOURCE_DIR, file);
};

// ==========================================================================================
// しきい値
// ==========================================================================================

/** ガター検出で「白」と見なす輝度の下限と、その行/列を白と判定する割合。 */
const GUTTER_WHITE = 245;
const GUTTER_RATIO = 0.995;

/**
 * 被写体検出で「白」と見なす輝度の下限。
 *
 * **これ以上上げてはいけない。** 素材の背景は純白ではなく実測 252〜255 のため、253 にすると
 * 背景全体が被写体と判定され、白余白ごと配置されて被写体が浮く（実測で縦占有 0.844 まで悪化）。
 */
const SUBJECT_WHITE = 245;

/**
 * 接地を確実にするため下へ寄せる量（キャンバスに対する比率）。
 *
 * 被写体の下端はアンチエイリアスで薄くなり、しきい値判定ではわずかに浮いて見える。
 * 下にはみ出した分は切れて構わないので、確実に接地させる。
 *
 * **絶対ピクセルで持たないこと。** キャンバスサイズを変えると効き方が変わる
 * （1024 基準で決めた 4px を 256 で使い、縦占有 0.855 まで欠けた）。
 */
const GROUND_BIAS_RATIO = 0.004;

/**
 * 検査で許容する縦占有の誤差。
 *
 * 256px へ縮小すると、髪の細いストロークなど淡い部分が SUBJECT_WHITE を上回り、被写体の上端が
 * 検出されないことがある。配置そのものは正しいため、この分を誤差として許容する。
 */
const HEIGHT_TOLERANCE = 0.06;

// ==========================================================================================
// 画像処理
// ==========================================================================================

interface Gray {
	data: Buffer;
	width: number;
	height: number;
}

interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

const toGray = async (source: string | Buffer): Promise<Gray> => {
	const { data, info } = await sharp(source)
		.greyscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return { data, width: info.width, height: info.height };
};

const isWhiteRow = (gray: Gray, y: number): boolean => {
	let white = 0;
	for (let x = 0; x < gray.width; x++) if (gray.data[y * gray.width + x] >= GUTTER_WHITE) white++;
	return white / gray.width >= GUTTER_RATIO;
};

const isWhiteColumn = (gray: Gray, x: number): boolean => {
	let white = 0;
	for (let y = 0; y < gray.height; y++) if (gray.data[y * gray.width + x] >= GUTTER_WHITE) white++;
	return white / gray.height >= GUTTER_RATIO;
};

/** 中央付近で最も長い白の帯を探し、その中心を分割位置として返す。 */
const findGutter = (length: number, isWhite: (index: number) => boolean): number => {
	const from = Math.floor(length * 0.25);
	const to = Math.ceil(length * 0.75);

	let best = { start: -1, length: 0 };
	let runStart = -1;

	for (let i = from; i <= to; i++) {
		if (isWhite(i)) {
			if (runStart < 0) runStart = i;
			const runLength = i - runStart + 1;
			if (runLength > best.length) best = { start: runStart, length: runLength };
		} else {
			runStart = -1;
		}
	}

	if (best.start < 0) throw new Error('白ガターを検出できない（素材が 2x2 でない可能性）');
	return best.start + Math.floor(best.length / 2);
};

/** 被写体のバウンディングボックス。被写体が無ければ null。 */
const subjectBox = (gray: Gray): Box | null => {
	let top = gray.height;
	let bottom = -1;
	let left = gray.width;
	let right = -1;

	for (let y = 0; y < gray.height; y++) {
		for (let x = 0; x < gray.width; x++) {
			if (gray.data[y * gray.width + x] < SUBJECT_WHITE) {
				if (y < top) top = y;
				if (y > bottom) bottom = y;
				if (x < left) left = x;
				if (x > right) right = x;
			}
		}
	}

	return bottom < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
};

/** 被写体を正方キャンバスへ、規定の縦占有・下端接地・横中央で配置する。 */
const normalize = async (figure: Buffer): Promise<Buffer> => {
	const box = subjectBox(await toGray(figure));
	if (!box) throw new Error('被写体を検出できない');

	const targetHeight = Math.round(SEED_CANVAS * SEED_SUBJECT_HEIGHT_RATIO);
	const scale = targetHeight / box.height;
	const targetWidth = Math.round(box.width * scale);

	let subject = await sharp(figure)
		.extract(box)
		.resize(targetWidth, targetHeight, { fit: 'fill' })
		.toBuffer();

	// 横がキャンバスを超える分ははみ出させて切る（高さ基準の正規化を保つ）。
	let placedWidth = targetWidth;
	if (targetWidth > SEED_CANVAS) {
		subject = await sharp(subject)
			.extract({
				left: Math.round((targetWidth - SEED_CANVAS) / 2),
				top: 0,
				width: SEED_CANVAS,
				height: targetHeight
			})
			.toBuffer();
		placedWidth = SEED_CANVAS;
	}

	const groundBias = Math.max(1, Math.round(SEED_CANVAS * GROUND_BIAS_RATIO));

	return sharp({
		create: { width: SEED_CANVAS, height: SEED_CANVAS, channels: 3, background: '#ffffff' }
	})
		.composite([
			{
				input: subject,
				top: SEED_CANVAS - targetHeight + groundBias,
				left: Math.round((SEED_CANVAS - placedWidth) / 2)
			}
		])
		.png()
		.toBuffer();
};

// ==========================================================================================
// 検査
// ==========================================================================================

interface Defect {
	name: string;
	reason: string;
}

const inspect = async (name: string, png: Buffer): Promise<Defect | null> => {
	const gray = await toGray(png);
	if (gray.width !== SEED_CANVAS || gray.height !== SEED_CANVAS) {
		return { name, reason: `寸法 ${gray.width}x${gray.height}（規定 ${SEED_CANVAS}）` };
	}

	const box = subjectBox(gray);
	if (!box) return { name, reason: '被写体を検出できない' };

	const bottomMargin = gray.height - (box.top + box.height);
	if (bottomMargin > 0) return { name, reason: `下端が接地していない（${bottomMargin}px 浮き）` };

	const heightRatio = box.height / gray.height;
	if (Math.abs(heightRatio - SEED_SUBJECT_HEIGHT_RATIO) > HEIGHT_TOLERANCE) {
		return {
			name,
			reason: `縦占有 ${heightRatio.toFixed(3)}（規定 ${SEED_SUBJECT_HEIGHT_RATIO} ±${HEIGHT_TOLERANCE}）`
		};
	}

	return null;
};

// ==========================================================================================
// 実行
// ==========================================================================================

const buildBucket = async (bucket: SeedBucket): Promise<Defect[]> => {
	const sourcePath = resolveSource(bucket);
	const png = await readFile(sourcePath).catch(() => {
		throw new Error(`素材が見つからない: ${sourcePath}`);
	});

	const gray = await toGray(png);
	const splitX = findGutter(gray.width, (x) => isWhiteColumn(gray, x));
	const splitY = findGutter(gray.height, (y) => isWhiteRow(gray, y));

	const quadrants = [
		{ left: 0, top: 0, width: splitX, height: splitY },
		{ left: splitX, top: 0, width: gray.width - splitX, height: splitY },
		{ left: 0, top: splitY, width: splitX, height: gray.height - splitY },
		{ left: splitX, top: splitY, width: gray.width - splitX, height: gray.height - splitY }
	];

	if (quadrants.length !== SEEDS_PER_BUCKET) {
		throw new Error(`素材から取れる個体数が SEEDS_PER_BUCKET と一致しない: ${sourcePath}`);
	}

	const defects: Defect[] = [];
	for (const [position, quadrant] of quadrants.entries()) {
		const name = seedFileName(bucket, SEED_INDICES[position]);
		const seed = await normalize(await sharp(png).extract(quadrant).png().toBuffer());
		await writeFile(join(OUT_DIR, name), seed);
		const defect = await inspect(name, seed);
		if (defect) defects.push(defect);
	}
	return defects;
};

const main = async () => {
	await mkdir(OUT_DIR, { recursive: true });

	const defects: Defect[] = [];
	for (const bucket of SEED_BUCKETS) {
		defects.push(...(await buildBucket(bucket)));
	}

	console.log(`シード ${SEED_BUCKETS.length * SEEDS_PER_BUCKET} 枚を生成`);

	if (defects.length > 0) {
		console.error(`規定を満たさないシード ${defects.length} 枚:`);
		for (const defect of defects) console.error(`  ${defect.name}: ${defect.reason}`);
		process.exit(1);
	}
	console.log(
		`検査 OK（${SEED_CANVAS}x${SEED_CANVAS} / 縦占有 ${SEED_SUBJECT_HEIGHT_RATIO} / 下端接地）`
	);
};

main().catch((err) => {
	console.error(err.message ?? err);
	process.exit(1);
});
