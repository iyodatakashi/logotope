import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const featureDirectory = 'src/lib/features/public/article-list';

const readSource = (fileName: string) => readFileSync(`${featureDirectory}/${fileName}`, 'utf8');

const ANIMATED_COMPONENTS = {
	'PublishedArticleListItem.svelte': {
		source: readSource('PublishedArticleListItem.svelte'),
		timeline: 'view()'
	}
};

const ALL_SOURCES = [
	'PublishedArticleListPage.svelte',
	'PublishedArticleListIntro.svelte',
	'PublishedArticleListItem.svelte'
].map((fileName) => ({ fileName, source: readSource(fileName) }));

/** セレクタから始まる 1 ブロックを取り出す（入れ子の無い CSS ルール前提） */
const blockAfter = (source: string, header: string) => {
	const start = source.indexOf(header);
	if (start < 0) return '';
	let depth = 0;
	for (let index = start; index < source.length; index++) {
		if (source[index] === '{') depth++;
		if (source[index] === '}') {
			depth--;
			if (depth === 0) return source.slice(start, index + 1);
		}
	}
	return '';
};

describe('演出の縮退', () => {
	it.each(Object.entries(ANIMATED_COMPONENTS))(
		'%s はスクロール駆動アニメーション未対応時に動きを止める',
		(_fileName, { source, timeline }) => {
			const block = blockAfter(source, `@supports not (animation-timeline: ${timeline})`);

			expect(block).toContain('animation: none');
		}
	);

	it.each(Object.entries(ANIMATED_COMPONENTS))(
		'%s は動きの抑制が設定されているときに動きを止める',
		(_fileName, { source }) => {
			const block = blockAfter(source, '@media (prefers-reduced-motion: reduce)');

			expect(block).toContain('animation: none');
		}
	);

	it('狭い縦長画面では変倍を止めない（モバイルでも演出を維持する）', () => {
		for (const { fileName, source } of ALL_SOURCES) {
			const block = blockAfter(source, '@media (max-width:');

			expect(`${fileName}: ${block}`).not.toContain('animation: none');
		}
	});

	it('動きの抑制時はスクロールに応じた色相の変化を行わない', () => {
		const page = readSource('PublishedArticleListPage.svelte');

		expect(page).toMatch(/prefersReducedMotion\.current\s*\?\s*HUE_ORIGIN_DEGREES/);
	});
});

describe('到達性', () => {
	it('フォーカスの輪郭を消さない', () => {
		const offending = ALL_SOURCES.filter(({ source }) =>
			/outline\s*:\s*(none|0)\b/.test(source)
		).map(({ fileName }) => fileName);

		expect(offending).toEqual([]);
	});

	it('円はすべて記事に対応するため、支援技術から隠す要素を持たない', () => {
		const offending = ALL_SOURCES.filter(({ source }) => source.includes('aria-hidden')).map(
			({ fileName }) => fileName
		);

		expect(offending).toEqual([]);
	});

	it('記事のリンクをキーボードのタブ移動から外さない', () => {
		for (const { source } of ALL_SOURCES) {
			expect(source).not.toMatch(/tabindex\s*=\s*["{]?-1/);
		}
	});

	it('フォーカスの着地点を画面の端から離す余地を持つ', () => {
		expect(readSource('PublishedArticleListItem.svelte')).toContain('scroll-margin-block');
	});
});
