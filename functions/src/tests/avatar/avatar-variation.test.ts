import { describe, it, expect } from 'vitest';
import { pickDeterministic } from '../../avatar/avatar-seeds';
import {
	resolveVariation,
	HAIR_CATALOG,
	BODY_CATALOG,
	POSE_CATALOG,
	ANGLE_CATALOG,
	GLASSES_CATALOG
} from '../../avatar/avatar-variation';

const manyIds = (n: number): string[] => Array.from({ length: n }, (_, i) => `persona-${i}`);

describe('resolveVariation', () => {
	it('同一 (personaId, attempt) は常に同一の軸集合を返す', () => {
		const a = resolveVariation('persona-x', 0, 'middle', 'masculine');
		const b = resolveVariation('persona-x', 0, 'middle', 'masculine');
		expect(a).toEqual(b);
	});

	it('各軸の値は対応するカタログから引く', () => {
		const v = resolveVariation('persona-x', 0, 'middle', 'masculine');
		expect(HAIR_CATALOG.middle.masculine).toContain(v.hair);
		expect(BODY_CATALOG).toContain(v.body);
		expect(POSE_CATALOG).toContain(v.pose);
		expect(ANGLE_CATALOG).toContain(v.angle);
		expect(GLASSES_CATALOG).toContain(v.glasses);
	});

	it('髪型は世代×外見表現ごとの語彙から引く', () => {
		const child = resolveVariation('persona-x', 0, 'child', 'feminine');
		expect(HAIR_CATALOG.child.feminine).toContain(child.hair);
	});

	it('persona 全体で髪型が偏らず複数に散る', () => {
		const hairs = new Set(manyIds(200).map((id) => resolveVariation(id, 0, 'young', 'feminine').hair));
		expect(hairs.size).toBeGreaterThan(1);
	});

	it('attempt を変えると別の軸を引きうる（再生成＝探索）', () => {
		const hairs = new Set(
			Array.from({ length: 20 }, (_, attempt) => resolveVariation('persona-x', attempt, 'young', 'feminine').hair)
		);
		expect(hairs.size).toBeGreaterThan(1);
	});

	it('カタログに1件追記しても導出は壊れない（要素数をハードコードせず、追記後も決定的・新要素も到達可能）', () => {
		const base = [...HAIR_CATALOG.young.masculine];
		const extended = [...base, '追記した新髪型'];
		const ids = manyIds(300);

		// 追記後も、全 persona が有効な要素を決定的に引く。
		for (const id of ids) {
			const picked = pickDeterministic(extended, id, 0, 'hair');
			expect(extended).toContain(picked);
			expect(pickDeterministic(extended, id, 0, 'hair')).toBe(picked);
		}
		// 追記した要素が到達可能である（列挙・要素数依存でなく分散で拾える）。
		const picks = new Set(ids.map((id) => pickDeterministic(extended, id, 0, 'hair')));
		expect(picks.has('追記した新髪型')).toBe(true);
	});
});
