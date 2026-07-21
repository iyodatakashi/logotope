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
// 決定的選択
//
// seed も可変軸（avatar-variation）も、同一性キー (personaId, attempt) から毎回同じ値を再計算して
// 引く。index を外部に保存する識別子には使わない（保存すると配列の並び替え・追記で意味がずれる）。
// ==========================================================================================

/**
 * 同一性キー（personaId・attempt・軸名など）から、配列の要素を決定的に1つ選ぶ。
 *
 * 同じキーは常に同じ要素を返す。キーに軸名を混ぜると軸ごとに独立した選択になる
 * （seed と髪型が連動しない）。ハッシュは FNV-1a 32bit で、暗号強度は要らない。
 * カタログを追記して要素数が変わると割り当ては変わりうるが、選択は毎回キーから再計算するため
 * （どこにも保存しない）挙動そのものは壊れない。可変軸は同一性ではなく見た目なので、これで足りる。
 */
export const pickDeterministic = <T>(
	items: readonly T[],
	...keyParts: (string | number)[]
): T => {
	const input = keyParts.join(':');
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash = Math.imul(hash ^ input.charCodeAt(i), 0x01000193);
	}
	return items[(hash >>> 0) % items.length];
};

/**
 * (personaId, attempt) から seed を決定的に1枚選ぶ。
 *
 * 同一 (personaId, attempt) は常に同一 seed。attempt を変えると別 seed を引く（再生成＝探索）。
 * seed アンカーの無い外見表現（androgynous）は「seed 無し」＝ null を返す（throw しない）。
 */
export const selectSeed = (
	personaId: string,
	attempt: number,
	generation: Generation,
	presentation: Presentation
): { fileName: string; index: number } | null => {
	if (!isSeedPresentation(presentation)) return null;
	const index = pickDeterministic(SEED_INDICES, personaId, attempt, 'seed');
	return { fileName: seedFileName({ generation, presentation }, index), index };
};
