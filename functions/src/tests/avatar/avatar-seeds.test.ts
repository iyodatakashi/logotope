import { describe, it, expect } from 'vitest';
import {
	toGeneration,
	seedFileName,
	selectSeed,
	pickDeterministic,
	isSeedPresentation,
	allSeedFileNames,
	SEED_INDICES,
	SEEDS_PER_BUCKET
} from '../../avatar/avatar-seeds';

const manyIds = (n: number): string[] => Array.from({ length: n }, (_, i) => `persona-${i}`);

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
	it('同一 (personaId, attempt) は常に同一 seed を返す', () => {
		const a = selectSeed('persona-x', 0, 'young', 'masculine');
		const b = selectSeed('persona-x', 0, 'young', 'masculine');
		expect(a).toEqual(b);
	});

	it('選んだ seed は命名・index が整合し、index は 1..SEEDS_PER_BUCKET に収まる', () => {
		const seed = selectSeed('persona-x', 0, 'young', 'masculine');
		expect(seed).not.toBeNull();
		expect(seed!.index).toBeGreaterThanOrEqual(1);
		expect(seed!.index).toBeLessThanOrEqual(SEEDS_PER_BUCKET);
		expect(seed!.fileName).toBe(
			seedFileName({ generation: 'young', presentation: 'masculine' }, seed!.index)
		);
	});

	it('androgynous は seed 無し（null）を返す（throw しない）', () => {
		expect(selectSeed('persona-x', 0, 'young', 'androgynous')).toBeNull();
		expect(isSeedPresentation('androgynous')).toBe(false);
	});

	it('attempt を変えると別 seed を引きうる（再生成＝探索）', () => {
		const indices = new Set(
			Array.from({ length: 20 }, (_, attempt) => selectSeed('persona-x', attempt, 'young', 'masculine')!.index)
		);
		expect(indices.size).toBeGreaterThan(1);
	});

	it('persona 全体で seed が偏らず 4 枚すべてに散る', () => {
		const indices = new Set(
			manyIds(400).map((id) => selectSeed(id, 0, 'middle', 'feminine')!.index)
		);
		expect(indices).toEqual(new Set(SEED_INDICES));
	});
});

describe('pickDeterministic', () => {
	it('同一キーは常に同一要素を返し、必ずカタログの要素を返す', () => {
		const items = ['a', 'b', 'c'] as const;
		const first = pickDeterministic(items, 'k', 1, 'salt');
		expect(pickDeterministic(items, 'k', 1, 'salt')).toBe(first);
		expect(items).toContain(first);
	});

	it('salt を変えると独立に選ぶ（軸が連動しない）', () => {
		const items = manyIds(50);
		const bySaltA = items.map((id) => pickDeterministic(['x', 'y', 'z', 'w'], id, 0, 'a'));
		const bySaltB = items.map((id) => pickDeterministic(['x', 'y', 'z', 'w'], id, 0, 'b'));
		expect(bySaltA).not.toEqual(bySaltB);
	});
});
