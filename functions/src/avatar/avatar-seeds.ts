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

/** 外見表現。persona の genderPresentation と同じ区分（性自認ではない）。全表現に seed アンカーがある。 */
export const PRESENTATIONS = ['masculine', 'feminine', 'neutral'] as const;
export type Presentation = (typeof PRESENTATIONS)[number];

/**
 * seed アンカーがある世代。young / senior は骨格が middle と近いため独自 seed を持たず、middle の
 * seed を流用する（＝素材はこの3区分にのみある）。年齢由来の世代→この区分の写像は toSeedGeneration。
 * 髪型など seed 以外の見た目は世代（5区分）で引き続き出し分ける（骨格の流用と混同しない）。
 */
export const SEED_GENERATIONS = [
	'child',
	'middle',
	'elder'
] as const satisfies readonly Generation[];

/** seed アンカーがある世代の型。バケット・命名・選択はこの範囲でのみ成立する。 */
export type SeedGeneration = (typeof SEED_GENERATIONS)[number];

/** age（数値）→ 世代。境界は requirements の年齢帯（10歳/10〜20代/30〜40代/50〜60代/70代以上）に対応。 */
export const toGeneration = (age: number): Generation => {
	if (age < 13) return 'child';
	if (age < 30) return 'young';
	if (age < 50) return 'middle';
	if (age < 70) return 'senior';
	return 'elder';
};

/** 世代 → seed の世代。young / senior は骨格の近い middle の seed を流用する。 */
export const toSeedGeneration = (generation: Generation): SeedGeneration =>
	generation === 'child' || generation === 'elder' ? generation : 'middle';

/** シードを引く単位。seed のある世代（3区分）と外見表現（3区分）の組み合わせ。 */
export interface SeedBucket {
	generation: SeedGeneration;
	presentation: Presentation;
}

/**
 * 全バケット。定義から導出する。
 * 手で列挙すると、区分を増やしたときに追随漏れが起きる。
 */
export const SEED_BUCKETS: readonly SeedBucket[] = SEED_GENERATIONS.flatMap((generation) =>
	PRESENTATIONS.map((presentation) => ({ generation, presentation }))
);

/**
 * 1バケットあたりのシード枚数。素材シート1枚の個体数（2行×3列＝6体）と一致する。
 * 同じバケットのペルソナ同士で構図が散る度合いがこの枚数で決まる。
 */
export const SEEDS_PER_BUCKET = 6;

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

// 枠（正方サイズ・縦占有・下端接地）は avatar-constants の SEED_CANVAS / SUBJECT_HEIGHT_RATIO を参照する。
// 正規化は高さ基準のみで、横に収まらない分ははみ出させて切る（横占有は制約しない）。横幅を一定範囲へ
// 収めようとすると、肩幅の広い個体・腕を広げたポーズで全体が小さくなり、頭の大きさが揃わなくなる
// （＝ズーム一貫という目的そのものを壊す）。肩が見切れても問題ない。

// ==========================================================================================
// ランダム選択
//
// seed も可変軸（avatar-variation）も、生成のたびにランダムで引く。personaId から固定しない：
// 作り直す＝今の見た目が気に入らない、なので同じものが出ては困る（決定的だと作り直しても変わらない）。
// index はどこにも保存しない（保存すると配列の並び替え・追記で意味がずれる）。
// ==========================================================================================

/** 配列から1要素をランダムに選ぶ。 */
export const pickRandom = <T>(items: readonly T[]): T =>
	items[Math.floor(Math.random() * items.length)];

/**
 * seed を1枚ランダムに選ぶ。年齢由来の世代を seed の世代（toSeedGeneration で child/middle/elder へ）に
 * 写し、外見表現と合わせたプールから引く。全外見表現に seed があるため必ず1枚返る。
 */
export const selectSeed = (
	generation: Generation,
	presentation: Presentation
): { fileName: string; index: number } => {
	const index = pickRandom(SEED_INDICES);
	return {
		fileName: seedFileName({ generation: toSeedGeneration(generation), presentation }, index),
		index
	};
};
