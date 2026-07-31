import { SCALE_LEVELS, generateColorPalette, hexToOklch } from '@14ch/color-palette-generator';
import type { ColorConfig } from '@14ch/color-palette-generator';

/* ==========================================================================
   値の指定点（Req 5.24）
   配色の振る舞いを決める値はここにだけ置く。ユーザーが調整する前提。
   ========================================================================== */

/** 色相の起点（度）。スクロール量 0 のときの色相。 */
export const HUE_ORIGIN_DEGREES = 262;

/** 1 画面ぶんスクロールしたときに回る色相の量（度）。記事件数やページ高には依存しない。 */
export const HUE_DEGREES_PER_VIEWPORT = 140;

/**
 * パレット再生成の間引き幅（度）。この幅を跨いだときだけパレットを作り直す。
 * 大きくするほど再生成は減るが、移行の中間色にくすみが出る。
 *
 * transition の補間は Oklab（直交系）で行われるため、色相差 Δh の 2 色の中間色は
 * 彩度が cos(Δh/2) 倍にへこむ。彩度の落ち込みが 1% 未満なら知覚されないという基準で、
 * **許容できる刻みの上限は約 16°**（cos(8°) ≈ 0.990）。
 * ここを 16° より大きくする場合は中間色のくすみを実物で確認すること。
 * （実測は src/tests/features/public/article-list/article-list-contrast.test.ts）
 */
export const HUE_QUANTIZE_STEP_DEGREES = 2;

/** CSS カスタムプロパティの接頭辞。`--{prefix}-{level}` の形で書き出される。 */
export const PALETTE_VARIABLE_PREFIX = 'published-article-list';

/** パレット生成のシード。色相だけがスクロールで動き、明度・彩度は固定。 */
export const PALETTE_SEED_LIGHTNESS = 0.55;
export const PALETTE_SEED_CHROMA = 0.15;

/** パレット生成の設定。色相以外の生成条件はここで決める。 */
export const PALETTE_CONFIG: ColorConfig = {
	prefix: PALETTE_VARIABLE_PREFIX,
	seedColor: '#000000',
	originLevel: 500,
	hueShiftMode: 'natural'
};

/* ========================================================================== */

/** CSS カスタムプロパティ名 → oklch() 記法の色。ルート要素へそのまま setProperty する。 */
export type PaletteVariables = Readonly<Record<string, string>>;

/**
 * スクロール量と画面高から色相角（度）を返す。
 * 1 画面スクロールするごとに `HUE_DEGREES_PER_VIEWPORT` だけ回る。
 * 画面高が未測定（0 以下）なら起点の色相を返す。
 */
export const hueForScroll = (scrollY: number, viewportHeight: number): number => {
	if (viewportHeight <= 0) return HUE_ORIGIN_DEGREES;

	return HUE_ORIGIN_DEGREES + (scrollY / viewportHeight) * HUE_DEGREES_PER_VIEWPORT;
};

/** 色相角を間引き幅で量子化する。刻みの内側では同じ値を返す。 */
export const quantizeHue = (hue: number): number =>
	Math.floor(hue / HUE_QUANTIZE_STEP_DEGREES) * HUE_QUANTIZE_STEP_DEGREES;

/**
 * 色相角からページ全体の配色を組み立てる。
 * 生成はライブラリに任せ、返った各段を 1 つの色のまま OKLCH 記法へ戻す。
 * 明度・彩度・色相へ分解して個別に扱わない（色相ごとのトーン調整を保つため。Req 5.19）。
 */
export const buildPaletteVariables = (hue: number): PaletteVariables => {
	const variables: Record<string, string> = {};
	for (const [level, hex] of Object.entries(buildPaletteHex(hue))) {
		const oklch = hexToOklch(hex);
		// 変換に失敗した段は書き出さず、CSS 側のフォールバック色に委ねる（Req 5.22）
		if (!oklch) continue;
		variables[`--${PALETTE_VARIABLE_PREFIX}-${level}`] = formatOklch(
			oklch.l,
			oklch.c,
			oklch.h ?? 0
		);
	}

	return variables;
};

/**
 * 色相角から段ごとの色を生成する。ライブラリはガマットに収めた HEX を返す。
 * 可読性の実測（コントラスト比）もこの結果を測る。
 */
export const buildPaletteHex = (hue: number): Readonly<Record<number, string>> => {
	const palette = generateColorPalette({
		...PALETTE_CONFIG,
		seedOklch: {
			mode: 'oklch',
			l: PALETTE_SEED_LIGHTNESS,
			c: PALETTE_SEED_CHROMA,
			h: normalizeHue(hue)
		}
	});

	const hexByLevel: Record<number, string> = {};
	for (const level of SCALE_LEVELS) {
		hexByLevel[level] = palette[`--${PALETTE_VARIABLE_PREFIX}-${level}`];
	}

	return hexByLevel;
};

const normalizeHue = (hue: number): number => ((hue % 360) + 360) % 360;

const formatOklch = (lightness: number, chroma: number, hue: number): string =>
	`oklch(${round(lightness, 4)} ${round(chroma, 4)} ${round(hue, 2)})`;

const round = (value: number, digits: number): number => Number(value.toFixed(digits));
