import { describe, it, expect } from 'vitest';
import {
	toGeneration,
	toSeedGeneration,
	seedFileName,
	selectSeed,
	pickRandom,
	allSeedFileNames,
	SEED_INDICES,
	SEEDS_PER_BUCKET
} from '../../avatar/avatar-seeds';

describe('toGeneration', () => {
	it('年齢帯の境界で世代が切り替わる', () => {
		expect(toGeneration(12)).toBe('child');
		expect(toGeneration(13)).toBe('young');
		expect(toGeneration(29)).toBe('young');
		expect(toGeneration(30)).toBe('middle');
		expect(toGeneration(49)).toBe('middle');
		expect(toGeneration(50)).toBe('senior');
		expect(toGeneration(69)).toBe('senior');
		expect(toGeneration(70)).toBe('elder');
	});
});

describe('toSeedGeneration', () => {
	it('young / senior は骨格の近い middle の seed を流用する（child / elder はそのまま）', () => {
		expect(toSeedGeneration('child')).toBe('child');
		expect(toSeedGeneration('young')).toBe('middle');
		expect(toSeedGeneration('middle')).toBe('middle');
		expect(toSeedGeneration('senior')).toBe('middle');
		expect(toSeedGeneration('elder')).toBe('elder');
	});
});

describe('seedFileName', () => {
	it('{generation}_{presentation}_{index}.png で命名する', () => {
		expect(seedFileName({ generation: 'middle', presentation: 'feminine' }, 3)).toBe(
			'middle_feminine_3.png'
		);
	});

	it('54枚を一意に識別する（3世代×3外見表現×6枚・重複なし）', () => {
		const names = allSeedFileNames();
		expect(names.length).toBe(54);
		expect(new Set(names).size).toBe(54);
	});
});

describe('selectSeed', () => {
	it('選んだ seed は命名・index が整合し、index は 1..SEEDS_PER_BUCKET に収まる', () => {
		const seed = selectSeed('young', 'masculine');
		expect(seed.index).toBeGreaterThanOrEqual(1);
		expect(seed.index).toBeLessThanOrEqual(SEEDS_PER_BUCKET);
		// young は middle の seed を流用するため、ファイル名は middle バケットになる。
		expect(seed.fileName).toBe(
			seedFileName({ generation: 'middle', presentation: 'masculine' }, seed.index)
		);
	});

	it('androgynous も seed を返す（全外見表現に seed アンカーがある）', () => {
		const seed = selectSeed('middle', 'androgynous');
		expect(seed.fileName).toBe(
			seedFileName({ generation: 'middle', presentation: 'androgynous' }, seed.index)
		);
	});

	it('senior は middle の seed プールから引く', () => {
		const names = new Set(
			Array.from({ length: 400 }, () => selectSeed('senior', 'feminine').fileName)
		);
		for (const name of names) expect(name.startsWith('middle_feminine_')).toBe(true);
	});

	it('生成のたびにランダムに引き、6 枚すべてに散る', () => {
		const indices = new Set(
			Array.from({ length: 600 }, () => selectSeed('middle', 'feminine').index)
		);
		expect(indices).toEqual(new Set(SEED_INDICES));
	});
});

describe('pickRandom', () => {
	it('必ずカタログの要素を返す', () => {
		const items = ['a', 'b', 'c'] as const;
		expect(items).toContain(pickRandom(items));
	});

	it('多数回引くと全要素に散る', () => {
		const items = ['x', 'y', 'z', 'w'] as const;
		const picked = new Set(Array.from({ length: 200 }, () => pickRandom(items)));
		expect(picked).toEqual(new Set(items));
	});
});
