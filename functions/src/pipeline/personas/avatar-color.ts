// ペルソナの配色（カラーキー）の決定的な割り当て。
// アバター画像は生成に失敗しうるが、配色は純関数で必ず決まる。長い記事で誰の発言かを
// 判別できる最低線はここが担保する（design.md「Error Handling」の第1層）。

// パレット系統名を色相環順に並べたもの（src/lib/assets/styles/variables.scss と同じ並び）。
// 濃淡は持たず系統名のみ。表示側が --{系統}-600 / --{系統}-100-transparent へ解決する。
export const AVATAR_COLOR_KEYS = [
	'ruby',
	'red',
	'scarlet',
	'orange',
	'amber',
	'honey',
	'yellow',
	'peridot',
	'sage',
	'green',
	'jade',
	'emerald',
	'turquoise',
	'cyan',
	'cerulean',
	'azure',
	'cobalt',
	'blue',
	'indigo',
	'violet',
	'purple',
	'magenta',
	'rose',
	'crimson'
] as const;

/**
 * ペルソナ数から、色相環上に分散した配色を人数分だけ決定的に割り当てる。
 * 系統数以下なら人数で割った間隔で拾うため全員が相異なり、超える分は色相環を一周して再利用する。
 * 入力は人数だけで、乱数も呼び出し順も使わない（同じ人数からは常に同じ割り当て）。
 */
export const assignAll = (personaCount: number): readonly string[] => {
	const total = AVATAR_COLOR_KEYS.length;
	const stride = Math.min(personaCount, total);
	return Array.from(
		{ length: personaCount },
		(_, index) => AVATAR_COLOR_KEYS[Math.floor((index * total) / stride) % total]
	);
};
