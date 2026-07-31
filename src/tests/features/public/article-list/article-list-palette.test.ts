import { describe, expect, it } from 'vitest';
import {
	HUE_DEGREES_PER_VIEWPORT,
	HUE_ORIGIN_DEGREES,
	HUE_QUANTIZE_STEP_DEGREES,
	PALETTE_VARIABLE_PREFIX,
	buildPaletteVariables,
	hueForScroll,
	quantizeHue
} from '$lib/features/public/article-list/article-list-palette';

const SCALE_LEVELS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const variableNameOf = (level: number) => `--${PALETTE_VARIABLE_PREFIX}-${level}`;

const parseOklch = (value: string) => {
	const matched = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
	if (!matched) throw new Error(`oklch 記法ではない: ${value}`);
	return { lightness: Number(matched[1]), chroma: Number(matched[2]), hue: Number(matched[3]) };
};

describe('hueForScroll', () => {
	it('スクロール量に対して単調に増える', () => {
		const viewportHeight = 800;
		const hues = [0, 200, 400, 800, 1600, 4000].map((scrollY) =>
			hueForScroll(scrollY, viewportHeight)
		);

		for (let index = 1; index < hues.length; index++) {
			expect(hues[index]).toBeGreaterThan(hues[index - 1]);
		}
	});

	it('同じ入力には同じ値を返す', () => {
		expect(hueForScroll(1234, 800)).toBe(hueForScroll(1234, 800));
	});

	it('1 画面ぶんスクロールすると設定した度数だけ回る', () => {
		const viewportHeight = 800;

		expect(
			hueForScroll(viewportHeight, viewportHeight) - hueForScroll(0, viewportHeight)
		).toBeCloseTo(HUE_DEGREES_PER_VIEWPORT);
		expect(
			hueForScroll(viewportHeight * 3, viewportHeight) - hueForScroll(0, viewportHeight)
		).toBeCloseTo(HUE_DEGREES_PER_VIEWPORT * 3);
	});

	it('画面高が 0 のときは起点の色相を返す', () => {
		expect(hueForScroll(1000, 0)).toBe(HUE_ORIGIN_DEGREES);
	});

	it('スクロール量が 0 のときは起点の色相を返す', () => {
		expect(hueForScroll(0, 800)).toBe(HUE_ORIGIN_DEGREES);
	});
});

describe('quantizeHue', () => {
	it('刻み幅の内側では同じ値を返す', () => {
		const base = HUE_ORIGIN_DEGREES;

		expect(quantizeHue(base + HUE_QUANTIZE_STEP_DEGREES * 0.1)).toBe(
			quantizeHue(base + HUE_QUANTIZE_STEP_DEGREES * 0.9)
		);
	});

	it('刻み幅を跨いだときだけ値が変わる', () => {
		const base = quantizeHue(HUE_ORIGIN_DEGREES);

		expect(quantizeHue(HUE_ORIGIN_DEGREES + HUE_QUANTIZE_STEP_DEGREES)).not.toBe(base);
	});

	it('元の色相の増加に対して減らない', () => {
		const quantized = [0, 5, 10, 40, 130, 400].map(quantizeHue);

		for (let index = 1; index < quantized.length; index++) {
			expect(quantized[index]).toBeGreaterThanOrEqual(quantized[index - 1]);
		}
	});
});

describe('buildPaletteVariables', () => {
	it('11 段ぶんの CSS カスタムプロパティを返す', () => {
		const variables = buildPaletteVariables(HUE_ORIGIN_DEGREES);

		expect(Object.keys(variables)).toEqual(SCALE_LEVELS.map(variableNameOf));
	});

	it('値がすべて OKLCH 記法で HEX を含まない', () => {
		const variables = buildPaletteVariables(HUE_ORIGIN_DEGREES);

		for (const value of Object.values(variables)) {
			expect(value).toMatch(/^oklch\([\d.]+ [\d.]+ [\d.]+\)$/);
		}
	});

	it('色相の起点を跨いだ値でも 11 段を返す', () => {
		const variables = buildPaletteVariables(HUE_ORIGIN_DEGREES + 720);

		expect(Object.keys(variables)).toEqual(SCALE_LEVELS.map(variableNameOf));
	});

	it('同じ色相には同じパレットを返す', () => {
		expect(buildPaletteVariables(120)).toEqual(buildPaletteVariables(120));
	});

	it('色相を変えると段ごとの明度・彩度も変わる', () => {
		const yellow = buildPaletteVariables(97);
		const blue = buildPaletteVariables(262);

		const lightnessChanged = SCALE_LEVELS.some(
			(level) =>
				parseOklch(yellow[variableNameOf(level)]).lightness !==
				parseOklch(blue[variableNameOf(level)]).lightness
		);
		const chromaChanged = SCALE_LEVELS.some(
			(level) =>
				parseOklch(yellow[variableNameOf(level)]).chroma !==
				parseOklch(blue[variableNameOf(level)]).chroma
		);

		expect(lightnessChanged).toBe(true);
		expect(chromaChanged).toBe(true);
	});
});
