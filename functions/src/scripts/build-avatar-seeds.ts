// 提供された素材（プロジェクトルート avatar-materials/）から、アバターのシードを初期導出した手順の記録。
//
// ## 位置づけ ── **再実行しない**
//
// 成果物 functions/src/avatar/seeds/ の PNG 群は、初期導出後に**手で調整済み**（顔高45%化を含む）の
// 確定アセットで、コミット済みの真実の源である。本スクリプトを再実行すると素材から再正規化して
// これらを上書きし、手動調整を消してしまう。したがって本ファイルは「どう導出したか」を読める記録として
// 残すためのものであり、実行はしない。ランタイムは seeds/ だけに依存し、素材と本スクリプトは無くても動く。
//
// 区分（世代・外見表現）は avatar-seeds.ts、効く定数は avatar-constants.ts が持つ。ここでは持たない。
// 導出手順: 素材シートを白ガター検出で 4 分割 → 各体を縦占有 0.92・下端接地・横中央・256 正方へ正規化
//   （横がはみ出す分は切る）→ 規定寸法・縦占有・下端接地を満たさなければ逸脱を報告して失敗扱い。

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SEED_CANVAS, SUBJECT_HEIGHT_RATIO } from '../avatar/avatar-constants.js';
import {
	SEED_BUCKETS,
	SEED_INDICES,
	SEEDS_PER_BUCKET,
	seedFileName,
	type Generation,
	type SeedPresentation,
	type SeedBucket
} from '../avatar/avatar-seeds.js';

// ==========================================================================================
// 素材の宣言
// ==========================================================================================

/**
 * バケットと素材ファイルの対応。
 *
 * **ファイル名から属性を導出しない。** 素材のリネームでシードのラベルが黙って変わるため。
 * 外見表現（masculine / feminine）を明示キーにし、素材ファイル名（male_ / female_）とは分ける。
 * 全バケット分が揃っているかは実行時に検査する（下記 resolveSource）。
 */
const SOURCE_FILES: Record<Generation, Record<SeedPresentation, string>> = {
	child: { masculine: 'male_child.png', feminine: 'female_child.png' },
	young: { masculine: 'male_young.png', feminine: 'female_young.png' },
	middle: { masculine: 'male_middle.png', feminine: 'female_middle.png' },
	senior: { masculine: 'male_senior.png', feminine: 'female_senior.png' },
	elder: { masculine: 'male_elder.png', feminine: 'female_elder.png' }
};

// 素材はプロジェクトルート avatar-materials/（seeds を切り出す元。ランタイム依存ではない）。
const SOURCE_DIR = fileURLToPath(new URL('../../../avatar-materials', import.meta.url));
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

	const targetHeight = Math.round(SEED_CANVAS * SUBJECT_HEIGHT_RATIO);
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
	if (Math.abs(heightRatio - SUBJECT_HEIGHT_RATIO) > HEIGHT_TOLERANCE) {
		return {
			name,
			reason: `縦占有 ${heightRatio.toFixed(3)}（規定 ${SUBJECT_HEIGHT_RATIO} ±${HEIGHT_TOLERANCE}）`
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
		`検査 OK（${SEED_CANVAS}x${SEED_CANVAS} / 縦占有 ${SUBJECT_HEIGHT_RATIO} / 下端接地）`
	);
};

main().catch((err) => {
	console.error(err.message ?? err);
	process.exit(1);
});
