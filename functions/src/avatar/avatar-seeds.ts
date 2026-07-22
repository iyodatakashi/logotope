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

/** seed アンカーがある外見表現の型。バケット・命名・選択はこの範囲でのみ成立する。 */
export type SeedPresentation = (typeof SEED_PRESENTATIONS)[number];

/** その外見表現に seed アンカーがあるか（androgynous は false）。 */
export const isSeedPresentation = (presentation: Presentation): presentation is SeedPresentation =>
	(SEED_PRESENTATIONS as readonly Presentation[]).includes(presentation);

/** age（数値）→ 世代。境界は requirements の年齢帯（10歳/10〜20代/30〜40代/50〜60代/70代以上）に対応。 */
export const toGeneration = (age: number): Generation => {
	if (age < 13) return 'child';
	if (age < 30) return 'young';
	if (age < 50) return 'middle';
	if (age < 70) return 'senior';
	return 'elder';
};

/** シードを引く単位。世代と外見表現の組み合わせ（seed のある外見表現に限る）。 */
export interface SeedBucket {
	generation: Generation;
	presentation: SeedPresentation;
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
 * seed を1枚ランダムに選ぶ。年齢・外見表現で適切なプール（世代×外見表現）まで絞ってから引く。
 * seed アンカーの無い外見表現（androgynous）は「seed 無し」＝ null を返す（throw しない）。
 */
export const selectSeed = (
	generation: Generation,
	presentation: Presentation
): { fileName: string; index: number } | null => {
	if (!isSeedPresentation(presentation)) return null;
	const index = pickRandom(SEED_INDICES);
	return { fileName: seedFileName({ generation, presentation }, index), index };
};
