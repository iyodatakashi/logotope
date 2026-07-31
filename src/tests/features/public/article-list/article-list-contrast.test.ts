import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	HUE_QUANTIZE_STEP_DEGREES,
	buildPaletteHex
} from '$lib/features/public/article-list/article-list-palette';

/**
 * 配色の可読性の実測。
 * 役割 → 段の割り当てはページのデザイン値ブロックが唯一の情報源なので、そこから読み取る。
 * 割り当てを変えるとこのテストがそのまま新しい配色を測る。
 */
const readSource = (fileName: string) =>
	readFileSync(`src/lib/features/public/article-list/${fileName}`, 'utf8');

/** セレクタから始まる 1 ブロックを取り出す */
const blockAfter = (source: string, header: string) => {
	const start = source.indexOf(header);
	if (start < 0) throw new Error(`見つからない: ${header}`);
	let depth = 0;
	for (let index = start; index < source.length; index++) {
		if (source[index] === '{') depth++;
		if (source[index] === '}') {
			depth--;
			if (depth === 0) return source.slice(start, index + 1);
		}
	}
	throw new Error(`閉じていない: ${header}`);
};

/** その宣言が参照しているパレットの段を読む（段の割り当てはコンポーネント側が唯一の情報源） */
const levelOf = (block: string, property: 'background-color' | 'color') => {
	// `color` が `background-color` の一部に一致しないよう、直前が単語構成文字でないことを要求する
	const matched = block.match(
		new RegExp(`(?:^|[^\\w-])${property}\\s*:\\s*var\\(--published-article-list-(\\d+)\\)`)
	);
	if (!matched) throw new Error(`${property} の段が読めない`);
	return Number(matched[1]);
};

const ITEM = readSource('PublishedArticleListItem.svelte');
const INTRO = readSource('PublishedArticleListIntro.svelte');
const PAGE = readSource('PublishedArticleListPage.svelte');

const CIRCLE = blockAfter(ITEM, '.published-article-list-item__link {');
const KIND = blockAfter(ITEM, '.published-article-list-item__kind {');
const INTRO_ROOT = blockAfter(INTRO, '.published-article-list-intro {');
const PAGE_ROOT = blockAfter(PAGE, '.published-article-list-page {');

/** 色相のサンプリング間隔（度）。色相環を一定間隔で巡って測る。 */
const HUE_SAMPLE_STEP_DEGREES = 15;

const SAMPLED_HUES = Array.from(
	{ length: 360 / HUE_SAMPLE_STEP_DEGREES },
	(_, step) => step * HUE_SAMPLE_STEP_DEGREES
);

/** WCAG 2.1 の相対輝度（測定用。適用する色の生成はライブラリに任せている） */
const relativeLuminance = (hex: string): number => {
	const channels = [1, 3, 5].map((offset) => {
		const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const contrastRatio = (foreground: string, background: string): number => {
	const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
		(a, b) => b - a
	);
	return (lighter + 0.05) / (darker + 0.05);
};

/** 読み取る必要のあるテキストと、その下地の組み合わせ */
const TEXT_PAIRS = [
	{
		name: '円の中のテキスト',
		foreground: levelOf(CIRCLE, 'color'),
		background: levelOf(CIRCLE, 'background-color')
	},
	{
		name: '種別ラベル・公開日',
		foreground: levelOf(KIND, 'color'),
		background: levelOf(CIRCLE, 'background-color')
	},
	{
		name: 'ロゴ・概要文',
		foreground: levelOf(INTRO_ROOT, 'color'),
		background: levelOf(PAGE_ROOT, 'background-color')
	}
];

/** WCAG AA（通常サイズのテキスト） */
const MINIMUM_CONTRAST_RATIO = 4.5;

describe('配色の可読性', () => {
	it.each(TEXT_PAIRS)('どの色相でも $name の可読性が保たれる', ({ foreground, background }) => {
		const foregroundLevel = foreground;
		const backgroundLevel = background;

		const worst = SAMPLED_HUES.map((hue) => {
			const palette = buildPaletteHex(hue);
			return { hue, ratio: contrastRatio(palette[foregroundLevel], palette[backgroundLevel]) };
		}).reduce((lowest, current) => (current.ratio < lowest.ratio ? current : lowest));

		expect(
			worst.ratio,
			`色相 ${worst.hue}° で最小 ${worst.ratio.toFixed(2)}:1`
		).toBeGreaterThanOrEqual(MINIMUM_CONTRAST_RATIO);
	});

	it('間引き幅が中間色のくすみを知覚させない範囲に収まっている', () => {
		// transition の補間は Oklab（直交系）で行われるため、色相差 Δh の 2 色の中間色は
		// 彩度が cos(Δh/2) 倍にへこむ。そのへこみ量を実測して上限を固定する。
		const chromaRetention = Math.cos((HUE_QUANTIZE_STEP_DEGREES * Math.PI) / 180 / 2);

		// 1% を超える彩度の落ち込みは中間色のくすみとして知覚されうる。
		// この式から許容できる間引き幅の上限は約 16°（cos(8°) ≈ 0.990）。
		expect(1 - chromaRetention).toBeLessThan(0.01);
	});
});
