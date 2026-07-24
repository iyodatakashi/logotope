// 髪型パラメータの「出現率レポート」（設計調整用）。
//
// 重みは相対値（正規化・長さ依存）なので、値を見ても出現率が読めない。そこで本番と同じ composeHair を
// 多数回まわし、各軸の実際の出現率を % で出す。重みを触ったらこれを実行して結果を数字で確認する。
// ＝使い捨て測定を本番コード（共有関数）を呼ぶ形で常駐させたもの。API は叩かない（純粋な確率計算）。
//
// 実行: cd functions && npx tsx src/avatar/verify-hair-distribution.ts [generation] [N]
//   例: npx tsx src/avatar/verify-hair-distribution.ts young 200000

import { composeHair } from './avatar-variation.js';
import { GENERATIONS, PRESENTATIONS, type Generation, type Presentation } from './avatar-seeds.js';

const generation = (process.argv[2] as Generation) ?? 'young';
const N = Number(process.argv[3] ?? 200000);
if (!GENERATIONS.includes(generation)) {
	console.error(`世代が不正: ${generation}（${GENERATIONS.join(' / ')}）`);
	process.exit(1);
}

const LENGTH_ORDER = ['VS', 'S', 'B', 'M', 'SL', 'L'];
const shortName = (s: string | undefined): string => (s ?? '').split('（')[0] || s || '';
const pct = (n: number, total: number): string =>
	total === 0 ? '  -' : `${((n / total) * 100).toFixed(0).padStart(2)}%`;

/** 出現数を、割合の降順に「名前 xx%」で連ねる（total で正規化）。 */
const line = (counts: Record<string, number>, total: number, order?: string[]): string => {
	const keys = order ?? Object.keys(counts).sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
	return keys.map((k) => `${k} ${pct(counts[k] ?? 0, total)}`).join(' / ');
};

const inc = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

const report = (presentation: Presentation) => {
	const length: Record<string, number> = {};
	const styling: Record<string, number> = { おろし: 0, まとめ: 0 };
	const silhouette: Record<string, number> = {};
	const bangs: Record<string, number> = {};
	const texture: Record<string, number> = {};
	const tie: Record<string, number> = {};
	let down = 0;
	let tied = 0;

	for (let i = 0; i < N; i++) {
		const c = composeHair(generation, presentation);
		inc(length, c.length);
		if (c.styling === 'down') {
			down++;
			inc(styling, 'おろし');
			inc(bangs, shortName(c.bangs));
			inc(silhouette, shortName(c.silhouette));
			inc(texture, c.texture ?? '（巻きで質感指定なし）');
		} else {
			tied++;
			inc(styling, 'まとめ');
			inc(tie, shortName(c.tie));
		}
	}

	console.log(`\n=== ${presentation}（generation=${generation}, N=${N}） ===`);
	console.log(`  長さ            : ${line(length, N, LENGTH_ORDER)}`);
	console.log(`  おろし/まとめ   : ${line(styling, N)}`);
	console.log(`  [おろし内] 前髪 : ${line(bangs, down)}`);
	console.log(`  [おろし内]ｼﾙｴｯﾄ : ${line(silhouette, down)}`);
	console.log(`  [おろし内] 質感 : ${line(texture, down)}`);
	console.log(`  [まとめ内]まとめ: ${tied ? line(tie, tied) : '（まとめ無し）'}`);
};

for (const p of PRESENTATIONS) report(p);
console.log('\n※ 前髪/シルエット/質感は「おろしの中での割合」、まとめ方は「まとめの中での割合」。');
