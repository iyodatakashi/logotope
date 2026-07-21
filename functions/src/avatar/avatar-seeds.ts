// アバターのシード（画像生成時に添付する編集の元画像）の定義。
//
// シードは画像生成のたびに1枚を file パートで添付する元画像であり、参照画像ではない。
// モデルはこれを編集して別個体を作るため、シードは出力へ枠（ズーム・目線・接地）・テイスト・構図を
// 転写する。どのシードを添付するかは、ペルソナの属性から決まる。
//
// **区分の定義はこのファイルにのみ置く。** 素材のファイル名や、ディレクトリの中身から導出しない。

/** 世代。シードが表現できる年齢の区分。 */
export const GENERATIONS = ['child', 'young', 'middle', 'senior', 'elder'] as const;
export type Generation = (typeof GENERATIONS)[number];

/** 外見表現。persona の genderPresentation と同じ区分（性自認ではない）。 */
export const PRESENTATIONS = ['masculine', 'feminine', 'androgynous'] as const;
export type Presentation = (typeof PRESENTATIONS)[number];

/**
 * seed アンカーがある外見表現。現状は masculine / feminine のみ。
 * androgynous のアンカーは後続で追加する（それまで seed バケットに含めない）。
 */
export const SEED_PRESENTATIONS = ['masculine', 'feminine'] as const satisfies readonly Presentation[];

/** age（数値）→ 世代。境界は requirements の年齢帯（10歳/10〜20代/30〜40代/50〜60代/70代以上）に対応。 */
export const toGeneration = (age: number): Generation => {
	if (age < 13) return 'child';
	if (age < 30) return 'young';
	if (age < 50) return 'middle';
	if (age < 70) return 'senior';
	return 'elder';
};

/** シードを引く単位。世代と外見表現の組み合わせ。 */
export interface SeedBucket {
	generation: Generation;
	presentation: Presentation;
}

/**
 * 全バケット。定義から導出する。
 * 手で列挙すると、区分を増やしたときに追随漏れが起きる。
 */
export const SEED_BUCKETS: readonly SeedBucket[] = GENERATIONS.flatMap((generation) =>
	SEED_PRESENTATIONS.map((presentation) => ({ generation, presentation }))
);

/**
 * 1バケットあたりのシード枚数。
 * 同じバケットのペルソナ同士で構図が散る度合いがこの枚数で決まる。
 */
export const SEEDS_PER_BUCKET = 4;

/** シードの連番。1 から SEEDS_PER_BUCKET まで。 */
export const SEED_INDICES: readonly number[] = Array.from(
	{ length: SEEDS_PER_BUCKET },
	(_, i) => i + 1
);

/** シードのファイル名。命名は区分の定義だけから決まる。 */
export const seedFileName = (bucket: SeedBucket, index: number): string =>
	`${bucket.generation}_${bucket.presentation}_${index}.png`;

/** シードが揃っているべき全ファイル名。 */
export const allSeedFileNames = (): string[] =>
	SEED_BUCKETS.flatMap((bucket) => SEED_INDICES.map((index) => seedFileName(bucket, index)));

// ==========================================================================================
// アセットの仕様
//
// 後処理（postprocess.py）が出す最終アセットと同じ枠に揃える。シードと最終アセットで枠がぶれると、
// 生成物の枠もぶれる。
// ==========================================================================================

/** 出力サイズ（正方）。 */
export const SEED_CANVAS = 256;

/** 被写体の縦占有。postprocess.py の SUBJECT_HEIGHT_RATIO と同じ値。 */
export const SEED_SUBJECT_HEIGHT_RATIO = 0.92;

/**
 * 横占有は制約しない。
 *
 * 正規化は高さ基準のみ。横に収まらない分ははみ出させて切る。横幅を一定範囲へ収めようとすると、
 * 肩幅の広い個体・腕を広げたポーズで全体が小さくなり、頭の大きさが揃わなくなる
 * （＝ズーム一貫という目的そのものを壊す）。肩が見切れても問題ない。
 */
