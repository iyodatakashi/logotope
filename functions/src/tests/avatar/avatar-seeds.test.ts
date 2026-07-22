import { describe, it, expect } from 'vitest';
import {
	toGeneration,
	seedFileName,
	selectSeed,
	pickRandom,
	isSeedPresentation,
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

describe('seedFileName', () => {
	it('{generation}_{presentation}_{index}.png で命名する', () => {
		expect(seedFileName({ generation: 'middle', presentation: 'feminine' }, 3)).toBe(
			'middle_feminine_3.png'
		);
	});

	it('40枚を一意に識別する（重複なし）', () => {
		const names = allSeedFileNames();
		expect(names.length).toBe(40);
		expect(new Set(names).size).toBe(40);
	});
});

describe('selectSeed', () => {
	it('選んだ seed は命名・index が整合し、index は 1..SEEDS_PER_BUCKET に収まる', () => {
		const seed = selectSeed('young', 'masculine');
		expect(seed).not.toBeNull();
		expect(seed!.index).toBeGreaterThanOrEqual(1);
		expect(seed!.index).toBeLessThanOrEqual(SEEDS_PER_BUCKET);
		expect(seed!.fileName).toBe(
			seedFileName({ generation: 'young', presentation: 'masculine' }, seed!.index)
		);
	});

	it('androgynous は seed 無し（null）を返す（throw しない）', () => {
		expect(selectSeed('young', 'androgynous')).toBeNull();
		expect(isSeedPresentation('androgynous')).toBe(false);
	});

	it('生成のたびにランダムに引き、4 枚すべてに散る', () => {
		const indices = new Set(
			Array.from({ length: 400 }, () => selectSeed('middle', 'feminine')!.index)
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
